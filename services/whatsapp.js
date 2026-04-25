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
 * Robust Auth State for Cloud (MySQL)
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
            if (rows.length > 0) return JSON.parse(rows[0].session_data, BufferJSON.reviver);
        } catch (e) { return null; }
        return null;
    };
    const removeData = async (key) => {
        await db.execute('DELETE FROM whatsapp_sessions WHERE user_id = ? AND session_key = ?', [uId, key]);
    };

    const credsData = await readData('creds');
    const creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) tasks.push(writeData(value, key));
                            else tasks.push(removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => { await writeData(creds, 'creds'); }
    };
}

/**
 * Core WhatsApp Engine
 */
async function initializeWhatsApp(userId, io) {
    const uId = parseInt(userId);
    if (sessions.has(uId)) return sessions.get(uId);
    if (initializing.has(uId)) return;

    initializing.add(uId);
    console.log(`[ENGINE] Starting for user ${uId}...`);

    try {
        const { state, saveCreds } = await useDatabaseAuthState(uId);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['EbotConnect', 'Chrome', '115.0.0'],
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 20000,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false, // Critical: don't download old chats
            markOnline: false,
        });

        sessions.set(uId, sock);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`[ENGINE] New QR for user ${uId}`);
                const qrDataUrl = await qrcode.toDataURL(qr);
                io.to(`user_${uId}`).emit('qr', qrDataUrl);
                initializing.delete(uId);
            }

            if (connection === 'close') {
                initializing.delete(uId);
                const error = lastDisconnect?.error;
                const statusCode = (error instanceof Boom)?.output?.statusCode || error?.message;
                console.log(`[ENGINE] Closed for ${uId}: ${statusCode}`);
                
                sessions.delete(uId);

                // If connection failed, wipe creds because they are likely corrupted/expired
                if (statusCode === 'Connection Failure' || statusCode === 401 || statusCode === 403) {
                    console.log(`[ENGINE] Cleaning up bad session for ${uId}...`);
                    await db.execute('DELETE FROM whatsapp_sessions WHERE user_id = ?', [uId]);
                    io.to(`user_${uId}`).emit('status', 'disconnected');
                    return;
                }

                // Normal retry for other errors
                setTimeout(() => initializeWhatsApp(uId, io), 5000);
            } 
            
            else if (connection === 'open') {
                initializing.delete(uId);
                console.log(`[ENGINE] User ${uId} is ONLINE`);
                await db.execute(
                    'INSERT INTO whatsapp_sessions (user_id, session_key, status, connected_at) VALUES (?, \'status_meta\', \'connected\', NOW()) ON DUPLICATE KEY UPDATE status=\'connected\', connected_at=NOW()',
                    [uId]
                );
                io.to(`user_${uId}`).emit('status', 'connected');
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return;

            // Fetch Biz Info
            const [bizInfo] = await db.execute(`
                SELECT b.is_active, u.business_name, b.description, b.products, b.prices, b.faqs, b.welcome_message, b.auto_reply_message 
                FROM business_info b JOIN users u ON b.user_id = u.id WHERE b.user_id = ? 
                ORDER BY b.id DESC LIMIT 1`, [uId]);
            
            if (!bizInfo || bizInfo.length === 0 || bizInfo[0].is_active !== 1) return;
            const biz = bizInfo[0];

            // AI Reply Logic
            const executeBotReply = async () => {
                try {
                    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
                    if (!body) return;

                    const [subs] = await db.execute('SELECT status FROM subscriptions WHERE user_id = ? AND status = \'active\' AND expiry_date > NOW()', [uId]);
                    if (!subs || subs.length === 0) return;

                    const replyText = await generateAIReply(body, biz);
                    if (!replyText) return;

                    await sock.sendPresenceUpdate('composing', remoteJid);
                    setTimeout(async () => {
                        await sock.sendMessage(remoteJid, { text: replyText });
                        await db.execute('INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
                            [uId, remoteJid.split('@')[0], body, replyText]);
                    }, 2000);
                } catch (err) { console.error('[BOT ERROR]', err.message); }
            };

            // Smart Delay (2 minutes for first message)
            const [recentLogs] = await db.execute(
                'SELECT id FROM messages WHERE user_id = ? AND customer_number = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1',
                [uId, remoteJid.split('@')[0]]
            );

            if (recentLogs.length === 0) {
                const pendingKey = `${uId}:${remoteJid}`;
                if (pendingBots.has(pendingKey)) clearTimeout(pendingBots.get(pendingKey));
                pendingBots.set(pendingKey, setTimeout(() => {
                    pendingBots.delete(pendingKey);
                    executeBotReply();
                }, 120000));
            } else {
                executeBotReply();
            }
        });

    } catch (err) {
        console.error(`[ENGINE FATAL]`, err.message);
        initializing.delete(uId);
    }
}

async function generateAIReply(customerMessage, bizInfo) {
    try {
        const apiKey = process.env.GROQ_API_KEY?.trim();
        if (!apiKey) return bizInfo.auto_reply_message || "Service offline.";

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: `You are the AI assistant for ${bizInfo.business_name}. Business Info: ${bizInfo.description}. Products: ${bizInfo.products}. FAQs: ${bizInfo.faqs}.` },
                { role: "user", content: customerMessage }
            ],
            temperature: 0.7
        }, { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 });

        return response.data.choices[0].message.content.trim();
    } catch (error) { 
        console.error('[AI ERROR]', error.response?.data || error.message);
        return bizInfo.auto_reply_message || "I'm having trouble thinking right now."; 
    }
}

module.exports = { initializeWhatsApp, sessions };
