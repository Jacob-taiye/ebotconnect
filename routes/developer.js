const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sessions } = require('../services/whatsapp');

// GET /api/v1/status
// Check the connection status of the WhatsApp bot for the authenticated user
router.get('/status', async (req, res) => {
  try {
    const userId = req.user_id;

    const [rows] = await db.execute(
      "SELECT status, connected_at FROM whatsapp_sessions WHERE user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(200).json({ status: 'disconnected' });
    }

    res.status(200).json({
      status: rows[0].status,
      connected_at: rows[0].connected_at
    });
  } catch (error) {
    console.error('[API Status Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/messages/send
// Send a WhatsApp message to a specific number
router.post('/messages/send', async (req, res) => {
  try {
    const userId = req.user_id;
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: "to" and "message"' });
    }

    // Ensure the number is formatted correctly (e.g., adding @s.whatsapp.net if missing)
    let remoteJid = to;
    if (!remoteJid.includes('@')) {
      remoteJid = `${remoteJid}@s.whatsapp.net`;
    }

    // Check if the user has an active session in memory
    const sock = sessions.get(parseInt(userId));
    if (!sock) {
      return res.status(503).json({ error: 'WhatsApp session is not active or disconnected' });
    }

    // Send the message
    await sock.sendMessage(remoteJid, { text: message });

    // Log the message in the database (optional but recommended for user tracking)
    await db.execute(
      'INSERT INTO messages (user_id, customer_number, message, bot_reply) VALUES (?, ?, ?, ?)',
      [userId, to, 'API Message', message]
    );

    res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('[API Send Message Error]', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
