const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const axios = require('axios');
const pino = require('pino');

const sessions = new Map();
const initializing = new Set();
const pendingBots = new Map();

/**
 * Initialize a WhatsApp session for a specific user
 */
async function initializeWhatsApp(userId, io) {
    // Convert userId to number to ensure consistency
    const uId = parseInt(userId);

    if (sessions.has(uId)) {
        console.log(`[SESSION] User ${uId} already has an active session.`);
        return sessions.get(uId);
    }
    if (initializing.has(uId)) {
        console.log(`[SESSION] User ${uId} is already being initialized.`);
        return;
    }

    initializing.add(uId);
    console.log(`[SESSION] Initializing WhatsApp for user ${uId}...`);

    const authFolder = path.join(__dirname, `../sessions/user_${uId}`);
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    let version = [2, 3000, 1017531202]; // Updated to a more recent stable version
    try {
        const { version: latestVersion } = await fetchLatestBaileysVersion();
        version = latestVersion;
        console.log(`[SESSION] User ${uId}: Using latest WhatsApp version: ${version}`);
    } catch (e) {
        console.log(`[SESSION] User ${uId}: Using hardcoded WhatsApp version fallback: ${version}`);
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['ebotconnect', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0, // Prevent some timeout issues
    });

    sessions.set(uId, sock);
    console.log(`[MAP] User ${uId} socket created. Total active: ${sessions.size}`);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        try {
            const { connection, lastDisconnect, qr } = update;
            console.log(`[SESSION UPDATE] User ${uId}: connection=${connection}, hasQR=${!!qr}`);

            if (qr) {
                console.log(`[SESSION] QR Generated for user ${uId}`);
                const qrDataUrl = await qrcode.toDataURL(qr);
                io.to(`user_${uId}`).emit('qr', qrDataUrl);
            }

            if (connection === 'close') {
                initializing.delete(uId);
                const error = lastDisconnect?.error;
                const statusCode = (error instanceof Boom)?.output?.statusCode || error?.message;

                const isFatal = [
                    DisconnectReason.loggedOut,
                    401,
                    409,
                    'Stream Errored (unknown)',
                    'Stream Errored (conflict)'
                ].includes(statusCode);

                console.log(`[SESSION] Connection closed for user ${uId}. Error: ${statusCode}. Fatal: ${isFatal}`);

                sessions.delete(uId);

                if (!isFatal) {
                    console.log(`[SESSION] Recoverable error. Reconnecting in 5s for user ${uId}...`);
                    setTimeout(() => initializeWhatsApp(uId, io), 5000);
                } else {
                    console.log(`[SESSION] Fatal connection error for user ${uId}. Stopping bot.`);
                    await db.execute('UPDATE whatsapp_sessions SET status = ? WHERE user_id = ?', ['disconnected', uId]);
                    await db.execute('UPDATE social_connections SET status = ? WHERE user_id = ? AND platform = ?', ['disconnected', uId, 'whatsapp']);
                    io.to(`user_${uId}`).emit('status', 'disconnected');
                }
            } else if (connection === 'open') {
                initializing.delete(uId);
                const userNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'unknown';
                console.log(`[SESSION] WhatsApp Connected for user ${uId} (Number: ${userNumber})`);

                // Update whatsapp_sessions table
                await db.execute(
                    'INSERT INTO whatsapp_sessions (user_id, status, connected_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE status=?, connected_at=NOW()',
                    [uId, 'connected', 'connected']
                );

                // Sync with social_connections table for the frontend list
                await db.execute(
                    `INSERT INTO social_connections (user_id, platform, account_id, status, connected_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE account_id = ?, status = ?, connected_at = NOW()`,
                    [uId, 'whatsapp', userNumber, 'connected', userNumber, 'connected']
                );

                console.log(`[SESSION] Emitting connected status to user_${uId}`);
                io.to(`user_${uId}`).emit('status', 'connected');
            }
        } catch (err) {
            console.error(`[SESSION ERROR] User ${uId} connection update failure:`, err);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const currentUserId = parseInt(uId);
            if (m.type !== 'notify') return;

            const msg = m.messages[0];
            if (!msg.message) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return;

            // --- 1. CRITICAL TOGGLE CHECK FIRST ---
            const [bizInfo] = await db.execute(`
                SELECT b.is_active, u.business_name, b.description, b.products, b.prices, b.faqs, b.working_hours, b.welcome_message, b.auto_reply_message 
                FROM business_info b JOIN users u ON b.user_id = u.id WHERE b.user_id = ? 
                ORDER BY b.id DESC LIMIT 1`,
                [currentUserId]
            );

            if (!bizInfo || bizInfo.length === 0 || bizInfo[0].is_active !== 1) {
                return; // Exit immediately if bot is toggled OFF
            }
            const biz = bizInfo[0];
            console.log(`[DEBUG] [USER ${currentUserId}] Message received from ${remoteJid}`);

            const pendingKey = `${currentUserId}:${remoteJid}`;

            // If the business owner (me) sends a message, cancel any pending bot response
            if (msg.key.fromMe) {
                if (pendingBots.has(pendingKey)) {
                    console.log(`[BOT_CANCEL] Manual reply. Cancelling bot.`);
                    clearTimeout(pendingBots.get(pendingKey));
                    pendingBots.delete(pendingKey);
                }
                return;
            }

            // --- 2. DELAY LOGIC (First Message Only) ---
            // Check if we've talked to this person in the last 30 minutes
            const [recentLogs] = await db.execute(
                'SELECT id FROM messages WHERE user_id = ? AND customer_number = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1',
                [currentUserId, remoteJid.split('@')[0]]
            );

            const isFirstMessage = recentLogs.length === 0;

            // Helper function to execute bot reply
            const executeBotReply = async () => {
                try {
                    if (!sessions.has(currentUserId)) return;

                    let body = "";
                    if (msg.message.conversation) body = msg.message.conversation;
                    else if (msg.message.extendedTextMessage) body = msg.message.extendedTextMessage.text;
                    else if (msg.message.imageMessage && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
                    else if (msg.message.videoMessage && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;

                    if (!body) return;

                    // Final Subscription Check
                    const [subs] = await db.execute(
                        'SELECT status FROM subscriptions WHERE user_id = ? AND status = "active" AND expiry_date > NOW()',
                        [currentUserId]
                    );
                    if (!subs || subs.length === 0) return;

                    console.log(`[BOT_REPLY] Generating reply for ${remoteJid}...`);
                    const replyText = await generateAIReply(body, biz);

                    await sock.sendPresenceUpdate('composing', remoteJid);
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(remoteJid, { text: replyText });
                            await db.execute(
                                'INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
                                [currentUserId, remoteJid.split('@')[0], body, replyText]
                            );
                        } catch (err) {
                            console.error(`[ERROR] Send failed:`, err.message);
                        }
                    }, 2000);
                } catch (err) {
                    console.error(`[FATAL] Bot Error during reply:`, err);
                }
            };

            if (isFirstMessage) {
                // It's the first message: apply 2-minute delay
                if (pendingBots.has(pendingKey)) {
                    clearTimeout(pendingBots.get(pendingKey));
                }

                console.log(`[BOT_SCHEDULED] First message from ${remoteJid}. Waiting 2 mins.`);
                const timeoutId = setTimeout(() => {
                    pendingBots.delete(pendingKey);
                    executeBotReply();
                }, 120000);

                pendingBots.set(pendingKey, timeoutId);
            } else {
                // Not the first message: reply immediately
                console.log(`[BOT_FAST] Continuing conversation with ${remoteJid}.`);
                executeBotReply();
            }
        } catch (err) {
            console.error(`[MESSAGES ERROR] User ${uId} message processing failure:`, err);
        }
    });

    return sock;
}

async function generateAIReply(customerMessage, bizInfo) {
    try {
        const apiKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
        if (!apiKey || apiKey === 'your_groq_api_key_here') {
            console.error("[GROQ] Missing or invalid API Key in .env");
            return bizInfo.auto_reply_message || "I'm sorry, I'm having trouble processing your request.";
        }

        // List of models to try in order of preference
        const modelsToTry = [
            "llama-3.3-70b-versatile",
            "llama3-70b-8192",
            "llama3-8b-8192"
        ];

        // Sanitize database fallbacks to avoid "null" strings
        const welcomeMessage = bizInfo.welcome_message && bizInfo.welcome_message !== 'null' ? bizInfo.welcome_message : "Hello! How can I help you today?";
        const autoReplyMessage = bizInfo.auto_reply_message && bizInfo.auto_reply_message !== 'null' ? bizInfo.auto_reply_message : "I'm sorry, I don't have enough information to answer that. Please contact us directly.";

        let lastError = null;

        for (const modelName of modelsToTry) {
            try {
                console.log(`[GROQ] Attempting ${modelName}...`);

                const response = await axios.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    {
                        model: modelName,
                        messages: [
                            {
                                role: "system",
                                content: `You are the official customer assistant for "${bizInfo.business_name}".

BUSINESS DETAILS:
- Description: ${bizInfo.description || 'N/A'}
- Products/Services: ${bizInfo.products || 'N/A'}
- Pricing: ${bizInfo.prices || 'N/A'}
- FAQs: ${bizInfo.faqs || 'N/A'}
- Working Hours: ${bizInfo.working_hours || 'N/A'}

INSTRUCTIONS:
1. GREETING: If the user says "hi", "hello", "good morning" or similar, reply ONLY with this exact text: "${welcomeMessage}"
2. ANSWERING: Use the BUSINESS DETAILS above to answer the user accurately.
3. FALLBACK: If the question is completely unrelated to the business or you don't know the answer, reply ONLY with this exact text: "${autoReplyMessage}"
4. STYLE: Be brief, professional, and friendly. Do not mention you are an AI or Llama model. Respond as a human employee.`
                            },
                            {
                                role: "user",
                                content: customerMessage
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 500
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    }
                );

                let text = response.data.choices[0].message.content.trim();

                // Final safety check against "null" or empty replies
                if (!text || text.toLowerCase() === 'null') {
                    return autoReplyMessage;
                }

                console.log(`[GROQ] Success with ${modelName}: "${text}"`);
                return text;

            } catch (err) {
                lastError = err;
                // ... rest of error handling
                const status = err.response?.status;
                if (status === 429) {
                    console.error(`[GROQ] RATE LIMIT for ${modelName}. Trying next model...`);
                } else {
                    console.warn(`[GROQ] ${modelName} failed: ${err.message}`);
                }
                continue;
            }
        }

        console.error("[GROQ] All models failed. Last error:", lastError?.message);
        return bizInfo.auto_reply_message || "I'm sorry, I'm having trouble processing your request.";

    } catch (error) {
        console.error("[GROQ] Fatal Error:", error.message);
        return bizInfo.auto_reply_message || "I'm sorry, I'm having trouble processing your request.";
    }
}

module.exports = { initializeWhatsApp, sessions };
