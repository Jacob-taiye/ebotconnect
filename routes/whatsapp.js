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
        const userId = parseInt(req.user.userId);
        
        // Remove from initializing set if stuck
        const { sessions, initializeWhatsApp } = require('../services/whatsapp');
        // This is a bit hacky but helps clear stuck states
        const initializing = req.app.get('initializing_set'); 
        if (initializing) initializing.delete(userId);

        await initializeWhatsApp(userId, io);
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

        // 3. Update database: Completely wipe session data to force fresh QR
        await db.execute('DELETE FROM whatsapp_sessions WHERE user_id = ?', [userId]);

        res.json({ message: "WhatsApp session wiped successfully" });
    } catch (error) {
        console.error("Logout Error:", error);
        res.status(500).json({ message: "Logout failed" });
    }
});

module.exports = router;
