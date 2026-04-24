const { 
    makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    proto,
    initAuthCreds,
    BufferJSON
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const db = require('../config/db');
const axios = require('axios');
const pino = require('pino');

const sessions = new Map();
const initializing = new Set();
const pendingBots = new Map();

/**
 * Custom Auth State for MySQL
 */
async function useDatabaseAuthState(userId) {
    const uId = parseInt(userId);

    const writeData = async (data, key) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await db.execute(
            'INSERT INTO whatsapp_sessions (user_id, session_key, session_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE session_data = ?',
            [uId, key, json, json]
        );
    };

    const readData = async (key) => {
        try {
            const [rows] = await db.execute(
                'SELECT session_data FROM whatsapp_sessions WHERE user_id = ? AND session_key = ?',
                [uId, key]
            );
            if (rows.length > 0) {
                return JSON.parse(rows[0].session_data, BufferJSON.reviver);
            }
        } catch (error) {
            return null;
        }
        return null;
    };

    const removeData = async (key) => {
        await db.execute(
            'DELETE FROM whatsapp_sessions WHERE user_id = ? AND session_key = ?',
            [uId, key]
        );
    };

    // Load credentials from database or initialize new ones
    const credsData = await readData('creds');
    const creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
}

/**
 * Initialize a WhatsApp session for a specific user
 */
async function initializeWhatsApp(userId, io) {
    const uId = parseInt(userId);
    
    if (sessions.has(uId)) {
        return sessions.get(uId);
    }
    if (initializing.has(uId)) {
        return; 
    }

    initializing.add(uId);
    console.log(`[SESSION] Initializing (Database Mode) for user ${uId}...`);

    // Use Database instead of File System
    const { state, saveCreds } = await useDatabaseAuthState(uId);
    
    let version = [2, 3000, 1017531202];
    try {
        const { version: latestVersion } = await fetchLatestBaileysVersion();
        version = latestVersion;
    } catch (e) {}

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['ebotconnect', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
    });

    sessions.set(uId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const qrDataUrl = await qrcode.toDataURL(qr);
            io.to(`user_${uId}`).emit('qr', qrDataUrl);
        }

        if (connection === 'close') {
            initializing.delete(uId);
            const error = lastDisconnect?.error;
            const statusCode = (error instanceof Boom)?.output?.statusCode || error?.message;
            
            const isFatal = [
                DisconnectReason.loggedOut,
                401, 409
            ].includes(statusCode);
            
            sessions.delete(uId);

            if (!isFatal) {
                setTimeout(() => initializeWhatsApp(uId, io), 5000);
            } else {
                await db.execute('UPDATE whatsapp_sessions SET status = "disconnected" WHERE user_id = ? AND session_key = "status_meta"', [uId]);
                io.to(`user_${uId}`).emit('status', 'disconnected');
            }
        } else if (connection === 'open') {
            initializing.delete(uId);
            console.log(`[SESSION] Connected for user ${uId}`);
            
            // Meta entry to track connection status
            await db.execute(
                'INSERT INTO whatsapp_sessions (user_id, session_key, status, connected_at) VALUES (?, "status_meta", "connected", NOW()) ON DUPLICATE KEY UPDATE status="connected", connected_at=NOW()',
                [uId]
            );
            io.to(`user_${uId}`).emit('status', 'connected');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message) return;
        const remoteJid = msg.key.remoteJid;
        if (remoteJid.endsWith('@g.us')) return;

        const [bizInfo] = await db.execute(`
            SELECT b.is_active, u.business_name, b.description, b.products, b.prices, b.faqs, b.working_hours, b.welcome_message, b.auto_reply_message 
            FROM business_info b JOIN users u ON b.user_id = u.id WHERE b.user_id = ? 
            ORDER BY b.id DESC LIMIT 1`,
            [uId]
        );
        
        if (!bizInfo || bizInfo.length === 0 || bizInfo[0].is_active !== 1) return;
        const biz = bizInfo[0];
        const pendingKey = `${uId}:${remoteJid}`;

        if (msg.key.fromMe) {
            if (pendingBots.has(pendingKey)) {
                clearTimeout(pendingBots.get(pendingKey));
                pendingBots.delete(pendingKey);
            }
            return;
        }

        const [recentLogs] = await db.execute(
            'SELECT id FROM messages WHERE user_id = ? AND customer_number = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1',
            [uId, remoteJid.split('@')[0]]
        );

        const isFirstMessage = recentLogs.length === 0;

        const executeBotReply = async () => {
            try {
                if (!sessions.has(uId)) return;
                let body = "";
                if (msg.message.conversation) body = msg.message.conversation;
                else if (msg.message.extendedTextMessage) body = msg.message.extendedTextMessage.text;
                else if (msg.message.imageMessage && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
                else if (msg.message.videoMessage && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;

                if (!body) return;

                const [subs] = await db.execute(
                    'SELECT status FROM subscriptions WHERE user_id = ? AND status = "active" AND expiry_date > NOW()',
                    [uId]
                );
                if (!subs || subs.length === 0) return;

                const replyText = await generateAIReply(body, biz);
                await sock.sendPresenceUpdate('composing', remoteJid);
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: replyText });
                        await db.execute(
                            'INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
                            [uId, remoteJid.split('@')[0], body, replyText]
                        );
                    } catch (err) {}
                }, 2000);
            } catch (err) {}
        };

        if (isFirstMessage) {
            if (pendingBots.has(pendingKey)) clearTimeout(pendingBots.get(pendingKey));
            const timeoutId = setTimeout(() => {
                pendingBots.delete(pendingKey);
                executeBotReply();
            }, 120000); 
            pendingBots.set(pendingKey, timeoutId);
        } else {
            executeBotReply();
        }
    });

    return sock;
}

async function generateAIReply(customerMessage, bizInfo) {
    try {
        const apiKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
        if (!apiKey) return bizInfo.auto_reply_message || "Service temporarily unavailable.";

        const welcomeMessage = bizInfo.welcome_message || "Hello! How can I help you today?";
        const autoReplyMessage = bizInfo.auto_reply_message || "I'm sorry, I don't have enough information to answer that.";

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `You are the official customer assistant for "${bizInfo.business_name}". Use these details: ${bizInfo.description}. Products: ${bizInfo.products}. FAQs: ${bizInfo.faqs}. Greeting: ${welcomeMessage}. Fallback: ${autoReplyMessage}.`
                    },
                    { role: "user", content: customerMessage }
                ],
                temperature: 0.7
            },
            {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 10000
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        return bizInfo.auto_reply_message || "I'm sorry, I'm having trouble processing your request.";
    }
}

module.exports = { initializeWhatsApp, sessions };
