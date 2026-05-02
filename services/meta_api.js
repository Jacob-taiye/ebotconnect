const axios = require('axios');
const db = require('../config/db');

// --- AI Reply Generation ---
async function generateAIReply(businessInfo, userMessage) {
    try {
        const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: `You are an AI assistant for a business. 
                    Description: ${businessInfo.description}
                    Products/Services: ${businessInfo.products}
                    Prices: ${businessInfo.prices}
                    FAQs: ${businessInfo.faqs}
                    Working Hours: ${businessInfo.working_hours}
                    Welcome Message: ${businessInfo.welcome_message}
                    Auto Reply Rule: ${businessInfo.auto_reply_message}
                    
                    Respond to the customer briefly, politely, and using only the provided information. Do not mention that you are an AI. If the customer wants to order, guide them based on the products available.`
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            temperature: 0.5,
            max_tokens: 250
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return groqRes.data.choices[0].message.content;
    } catch (err) {
        console.error("Groq AI Error:", err.response?.data || err.message);
        return "I'm currently unable to respond. Please try again later.";
    }
}

// --- Platform Message Senders ---

async function sendWhatsAppMessage(phoneId, to, text, accessToken) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: text }
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    } catch (err) {
        console.error('WhatsApp Send Error:', err.response?.data || err.message);
    }
}

async function sendMessengerOrIGMessage(pageOrIgId, recipientId, text, accessToken) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/${pageOrIgId}/messages`, {
            recipient: { id: recipientId },
            message: { text: text }
        }, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    } catch (err) {
        console.error('Messenger/IG Send Error:', err.response?.data || err.message);
    }
}

// --- Main Bot Logic ---

async function processBotLogic(platform, accountId, senderId, messageText) {
    try {
        // 1. Find the user connected to this account_id
        const [connections] = await db.execute(
            "SELECT user_id, access_token FROM social_connections WHERE account_id = ? AND platform = ? AND status = 'connected'",
            [accountId, platform]
        );

        if (connections.length === 0) {
            console.log(`No active connection found for ${platform} account ${accountId}`);
            return;
        }

        const userId = connections[0].user_id;
        const accessToken = connections[0].access_token;

        // 2. Check Business Status
        const [bInfo] = await db.execute('SELECT * FROM business_info WHERE user_id = ? AND is_active = 1', [userId]);
        if (bInfo.length === 0) return; // Business is inactive/unsubscribed

        const businessInfo = bInfo[0];

        // 3. Save User Message
        await db.execute(
            'INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
            [userId, senderId, messageText, "Generating..."]
        );
        const [lastMsg] = await db.execute('SELECT LAST_INSERT_ID() as id');
        const msgId = lastMsg[0].id;

        // 4. Generate AI Reply
        const aiReply = await generateAIReply(businessInfo, messageText);

        // 5. Send Reply back to the user
        if (platform === 'whatsapp') {
            await sendWhatsAppMessage(accountId, senderId, aiReply, accessToken);
        } else {
            // Both Messenger and IG use the same messaging endpoint structure
            await sendMessengerOrIGMessage(accountId, senderId, aiReply, accessToken);
        }

        // 6. Update Database
        await db.execute('UPDATE messages SET bot_reply = ? WHERE id = ?', [aiReply, msgId]);

        // 7. Notify Frontend Dashboard (if socket is connected)
        try {
            const { io } = require('../server');
            if (io) {
                io.to(`user_${userId}`).emit('new_message', {
                    customer_number: senderId,
                    message: messageText,
                    bot_reply: aiReply,
                    platform: platform,
                    created_at: new Date().toISOString()
                });
            }
        } catch (e) {
            console.log('Socket notification failed (normal if io not available):', e.message);
        }

    } catch (error) {
        console.error(`[PROCESS BOT LOGIC ERROR] ${platform}:`, error);
    }
}

// --- Webhook Payload Handler ---

async function handleIncomingMessage(body) {
    if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                const value = change.value;
                if (value.messages && value.messages.length > 0) {
                    const message = value.messages[0];
                    const phoneId = value.metadata.phone_number_id;
                    const from = message.from;
                    const msgText = message.text?.body;
                    if (msgText) {
                        await processBotLogic('whatsapp', phoneId, from, msgText);
                    }
                }
            }
        }
    } else if (body.object === 'page') {
        // Facebook Messenger Webhook
        for (const entry of body.entry) {
            const pageId = entry.id;
            if (entry.messaging) {
                for (const messagingEvent of entry.messaging) {
                    const senderId = messagingEvent.sender?.id;
                    const msgText = messagingEvent.message?.text;
                    if (senderId && msgText) {
                        await processBotLogic('messenger', pageId, senderId, msgText);
                    }
                }
            }
        }
    } else if (body.object === 'instagram') {
        // Instagram Webhook
        for (const entry of body.entry) {
            const igAccountId = entry.id;
            if (entry.messaging) {
                for (const messagingEvent of entry.messaging) {
                    const senderId = messagingEvent.sender?.id;
                    const msgText = messagingEvent.message?.text;
                    if (senderId && msgText) {
                        await processBotLogic('instagram', igAccountId, senderId, msgText);
                    }
                }
            }
        }
    }
}

module.exports = {
    handleIncomingMessage
};
