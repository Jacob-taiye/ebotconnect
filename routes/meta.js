const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { handleIncomingMessage } = require('../services/meta_api');

// Get Meta Config (App ID) for Frontend
router.get('/config', authenticateToken, (req, res) => {
    res.json({ appId: process.env.META_APP_ID });
});

// Meta Webhook Verification
router.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('META WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Incoming Meta Webhook (Messages)
router.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        // Meta requires a 200 OK immediately
        res.status(200).send('EVENT_RECEIVED');

        if (body.object) {
            // Process the webhook payload asynchronously
            await handleIncomingMessage(body);
        }
    } catch (error) {
        console.error('[META WEBHOOK ERROR]:', error);
    }
});

// Save Social Connection (from frontend Facebook Login)
router.post('/connect', authenticateToken, async (req, res) => {
    const { platform, access_token, account_id } = req.body;
    const userId = parseInt(req.user.userId);

    try {
        if (!['whatsapp', 'instagram', 'messenger'].includes(platform)) {
            return res.status(400).json({ message: "Invalid platform" });
        }

        await db.execute(
            `INSERT INTO social_connections (user_id, platform, access_token, account_id, status, connected_at)
             VALUES (?, ?, ?, ?, 'connected', NOW())
             ON DUPLICATE KEY UPDATE access_token = ?, account_id = ?, status = 'connected', connected_at = NOW()`,
            [userId, platform, access_token, account_id, access_token, account_id]
        );

        res.json({ message: `Successfully connected ${platform}` });
    } catch (error) {
        console.error(`[META CONNECT ERROR]:`, error);
        res.status(500).json({ message: "Failed to save connection: " + error.message });
    }
});

// Disconnect Social
router.post('/disconnect', authenticateToken, async (req, res) => {
    const { platform } = req.body;
    const userId = parseInt(req.user.userId);

    try {
        await db.execute(
            `DELETE FROM social_connections WHERE user_id = ? AND platform = ?`,
            [userId, platform]
        );
        res.json({ message: `Successfully disconnected ${platform}` });
    } catch (error) {
        console.error(`[META DISCONNECT ERROR]:`, error);
        res.status(500).json({ message: "Failed to disconnect" });
    }
});

// Get Connection Status
router.get('/status', authenticateToken, async (req, res) => {
    const userId = parseInt(req.user.userId);
    try {
        const [connections] = await db.execute(
            'SELECT platform, account_id, status FROM social_connections WHERE user_id = ?',
            [userId]
        );
        res.json(connections);
    } catch (error) {
        console.error('[META STATUS ERROR]:', error);
        res.status(500).json({ message: "Failed to get status" });
    }
});

module.exports = router;
