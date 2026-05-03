const express = require('express');
const router = express.Router();
const { initializeWhatsApp, sessions } = require('../services/whatsapp');
const authenticateToken = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

// Start WhatsApp Engine for User
router.post('/start', authenticateToken, async (req, res) => {
    try {
        const io = req.app.get('socketio');
        await initializeWhatsApp(req.user.userId, io);
        res.json({ message: "WhatsApp engine started" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to start WhatsApp engine" });
    }
});

// Logout/Disconnect WhatsApp
router.post('/logout', authenticateToken, async (req, res) => {
    const userId = parseInt(req.user.userId);
    try {
        console.log(`Resetting WhatsApp session for user ${userId}...`);

        // 1. Close session in memory if exists
        if (sessions.has(userId)) {
            try {
                const sock = sessions.get(userId);
                sock.ev.removeAllListeners(); // Stop listening to events
                sock.end(); // Close connection
            } catch (e) {
                console.log("Error closing socket in memory:", e.message);
            }
            sessions.delete(userId);
        }

        // 2. Clear session files from folder
        const sessionPath = path.join(__dirname, `../sessions/user_${userId}`);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`Cleared session files for user ${userId}`);
        }

        // 3. Update database status
        await db.execute('UPDATE whatsapp_sessions SET status = ? WHERE user_id = ?', ['disconnected', userId]);

        res.json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout Error:", error);
        res.status(500).json({ message: "Logout failed" });
    }
});

module.exports = router;
