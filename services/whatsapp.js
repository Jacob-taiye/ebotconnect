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
            syncFullHistory: false,
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
                
                // Clear from sessions map immediately on close
                if (sessions.get(uId) === sock) {
                    sessions.delete(uId);
                }

                if (statusCode === 'Connection Failure' || statusCode === 401 || statusCode === 403) {
                    console.log(`[ENGINE] Cleaning up bad session for ${uId}...`);
                    await db.execute('DELETE FROM whatsapp_sessions WHERE user_id = ?', [uId]);
                    io.to(`user_${uId}`).emit('status', 'disconnected');
                    return;
                }

                // If conflict, wait longer before retrying to let the other instance die (Render deploy)
                const delay = statusCode === 'Stream Errored (conflict)' ? 10000 : 5000;
                setTimeout(() => initializeWhatsApp(uId, io), delay);
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
            if (!msg.message) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

            const pendingKey = `${uId}:${remoteJid}`;

            // --- Human Override Logic ---
            if (msg.key.fromMe) {
                if (pendingBots.has(pendingKey)) {
                    console.log(`[BOT] Manual reply detected for ${remoteJid}. Cancelling AI response.`);
                    clearTimeout(pendingBots.get(pendingKey));
                    pendingBots.delete(pendingKey);
                }
                return;
            }

            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
            if (!body) return;

            console.log(`[BOT] Incoming message from ${remoteJid}: "${body}"`);

            // Fetch Biz Info
            const [bizInfo] = await db.execute(`
                SELECT b.is_active, u.business_name, b.description, b.products, b.prices, b.faqs, b.working_hours, b.welcome_message, b.auto_reply_message 
                FROM business_info b JOIN users u ON b.user_id = u.id WHERE b.user_id = ? 
                ORDER BY b.id DESC LIMIT 1`, [uId]);
            
            if (!bizInfo || bizInfo.length === 0) {
                console.log(`[BOT] No business info found for user ${uId}`);
                return;
            }
            
            if (bizInfo[0].is_active !== 1) {
                console.log(`[BOT] Bot is set to OFF for user ${uId}`);
                return;
            }

            const biz = bizInfo[0];

            // AI Reply Logic
            const executeBotReply = async () => {
                try {
                    console.log(`[BOT] Starting AI reply process for ${remoteJid}`);

                    const [subs] = await db.execute('SELECT status FROM subscriptions WHERE user_id = ? AND status = \'active\' AND expiry_date > NOW()', [uId]);
                    if (!subs || subs.length === 0) {
                        console.log(`[BOT] User ${uId} has no active subscription!`);
                        return;
                    }

                    const replyText = await generateAIReply(body, biz);
                    if (!replyText) {
                        console.log(`[BOT] AI failed to return a string.`);
                        return;
                    }

                    // CRITICAL: Always use the LATEST socket from the sessions map
                    const currentSock = sessions.get(uId);
                    if (!currentSock) {
                        console.log(`[BOT] Lost connection for ${uId} during AI call. Aborting reply.`);
                        return;
                    }

                    await currentSock.sendPresenceUpdate('composing', remoteJid);
                    setTimeout(async () => {
                        try {
                            const finalSock = sessions.get(uId);
                            if (!finalSock) return;
                            
                            let finalReplyText = replyText;
                            const cleanNumber = remoteJid.split('@')[0].split(':')[0];
                            
                            if (replyText.includes('[ORDER_TAKEN]')) {
                                const parts = replyText.split('[ORDER_TAKEN]');
                                finalReplyText = parts[0].trim();
                                const orderSummary = parts.slice(1).join('[ORDER_TAKEN]').trim();
                                
                                await db.execute('INSERT INTO orders (user_id, customer_number, order_details) VALUES (?, ?, ?)',
                                    [uId, cleanNumber, orderSummary]);
                                
                                io.to(`user_${uId}`).emit('new_order', {
                                    customer_number: cleanNumber,
                                    details: orderSummary
                                });
                            }
                            
                            await finalSock.sendMessage(remoteJid, { text: finalReplyText });
                            await db.execute('INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
                                [uId, cleanNumber, body, finalReplyText]);
                            console.log(`[BOT] Successfully replied to ${remoteJid}`);
                        } catch (sendErr) {
                            console.error('[BOT SEND ERROR]', sendErr.message);
                        }
                    }, 2000);
                } catch (err) { console.error('[BOT ERROR]', err.message); }
            };

            // Smart Delay (2 minutes for first message)
            const [recentLogs] = await db.execute(
                'SELECT id FROM messages WHERE user_id = ? AND customer_number = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1',
                [uId, remoteJid.split('@')[0].split(':')[0]]
            );

            if (recentLogs.length === 0) {
                console.log(`[BOT] New customer ${remoteJid}. Waiting 2 mins (Smart Delay)...`);
                const pendingKey = `${uId}:${remoteJid}`;
                if (pendingBots.has(pendingKey)) clearTimeout(pendingBots.get(pendingKey));
                pendingBots.set(pendingKey, setTimeout(() => {
                    pendingBots.delete(pendingKey);
                    executeBotReply();
                }, 120000));
            } else {
                console.log(`[BOT] Ongoing conversation with ${remoteJid}. Replying immediately.`);
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
        if (!apiKey) {
            console.error('[AI] ERROR: GROQ_API_KEY is missing from environment variables!');
            return bizInfo.auto_reply_message || "Service offline.";
        }

        console.log(`[AI] Calling Groq for "${customerMessage.substring(0, 20)}..."`);
        
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { 
                    role: "system", 
                    content: `You are the official customer assistant for "${bizInfo.business_name}".

STRICT BUSINESS CONTEXT:
- Description: ${bizInfo.description || 'N/A'}
- Products/Services: ${bizInfo.products || 'N/A'}
- Prices/Pricing: ${bizInfo.prices || 'N/A'}
- Working Hours: ${bizInfo.working_hours || 'N/A'}
- FAQs (Frequently Asked Questions): ${bizInfo.faqs || 'N/A'}

STRICT RULES:
1. ONLY use the information provided in the "STRICT BUSINESS CONTEXT" above.
2. If a user asks something NOT covered by the context (like prices or services not listed, or questions not in FAQs), politely say you don't have that information and ask them to contact the business directly.
3. Use the "Working Hours" to answer any questions about when the business is open or closed.
4. Use the "FAQs" section to provide direct answers to common customer questions.
5. Do NOT make up products, prices, or details.
6. Keep replies extremely concise (1-2 sentences).
7. Be professional and friendly.
8. NEVER mention you are an AI, a bot, or an assistant. Speak as an employee.
9. If the user just says "Hi" or "Hello", use this welcome message: ${bizInfo.welcome_message || 'Hello! How can we help you today?'}
10. If the customer confirms an order, you MUST append the exact phrase "[ORDER_TAKEN]" followed by the order summary at the very end of your message. For example: "Thank you! [ORDER_TAKEN] 2x Apples, 1x Banana."` 
                },
                { role: "user", content: customerMessage }
            ],
            temperature: 0.1
        }, { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 15000 });

        return response.data.choices[0].message.content.trim();
    } catch (error) { 
        console.error('[AI ERROR]', error.response?.data || error.message);
        return bizInfo.auto_reply_message || "I'm having trouble thinking right now."; 
    }
}

module.exports = { initializeWhatsApp, sessions };
