const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authenticateAdmin = require('../middleware/adminAuth');

// 1. Admin Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [admins] = await db.execute('SELECT * FROM admins WHERE email = ?', [email]);
        if (admins.length === 0) return res.status(401).json({ message: "Invalid credentials" });

        const admin = admins[0];
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        const token = jwt.sign(
            { adminId: admin.id, username: admin.username, isAdmin: true },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, admin: { username: admin.username, email: admin.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// 2. Global Stats
router.get('/stats', authenticateAdmin, async (req, res) => {
    try {
        const [totalBusinesses] = await db.execute('SELECT COUNT(*) as count FROM users');
        const [activeSubs] = await db.execute('SELECT COUNT(*) as count FROM subscriptions WHERE status = \'active\' AND expiry_date > NOW()');
        const [totalRevenue] = await db.execute('SELECT SUM(amount) as total FROM subscriptions WHERE status = \'active\'');
        const [totalMessages] = await db.execute('SELECT COUNT(*) as count FROM messages');
        const [newSignups] = await db.execute('SELECT COUNT(*) as count FROM users WHERE created_at >= CURDATE()');

        res.json({
            totalBusinesses: totalBusinesses[0].count,
            activeSubs: activeSubs[0].count,
            totalRevenue: totalRevenue[0].total || 0,
            totalMessages: totalMessages[0].count,
            newSignups: newSignups[0].count
        });
    } catch (err) {
        res.status(500).json({ message: "Error fetching stats" });
    }
});

// 3. Businesses Management
router.get('/businesses', authenticateAdmin, async (req, res) => {
    try {
        const [businesses] = await db.execute(`
            SELECT u.id, u.business_name, u.email, u.phone, u.status, u.created_at, 
            s.plan_name, s.status as sub_status 
            FROM users u 
            LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
            ORDER BY u.created_at DESC
        `);
        res.json(businesses);
    } catch (err) {
        res.status(500).json({ message: "Error fetching businesses" });
    }
});

router.post('/businesses/:id/status', authenticateAdmin, async (req, res) => {
    const { status } = req.body;
    try {
        await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Error updating status" });
    }
});

router.delete('/businesses/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Error deleting business" });
    }
});

// 4. Subscriptions / Payments
router.get('/subscriptions', authenticateAdmin, async (req, res) => {
    try {
        const [subs] = await db.execute(`
            SELECT s.*, u.business_name, u.email 
            FROM subscriptions s 
            JOIN users u ON s.user_id = u.id 
            ORDER BY s.start_date DESC
        `);
        res.json(subs);
    } catch (err) {
        res.status(500).json({ message: "Error fetching subscriptions" });
    }
});

// 5. Messages Overview
router.get('/messages', authenticateAdmin, async (req, res) => {
    const { businessId, date } = req.query;
    let query = `
        SELECT m.*, u.business_name 
        FROM messages m 
        JOIN users u ON m.user_id = u.id
    `;
    let params = [];
    
    if (businessId || date) {
        query += " WHERE 1=1";
        if (businessId) {
            query += " AND m.user_id = ?";
            params.push(businessId);
        }
        if (date) {
            query += " AND DATE(m.created_at) = ?";
            params.push(date);
        }
    }
    
    query += " ORDER BY m.created_at DESC LIMIT 500";
    
    try {
        const [messages] = await db.execute(query, params);
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: "Error fetching messages" });
    }
});

// 6. Platform Settings
router.get('/settings', authenticateAdmin, async (req, res) => {
    try {
        const [settings] = await db.execute('SELECT * FROM platform_settings');
        const settingsMap = {};
        settings.forEach(s => settingsMap[s.setting_key] = s.setting_value);
        res.json(settingsMap);
    } catch (err) {
        res.status(500).json({ message: "Error fetching settings" });
    }
});

router.post('/settings', authenticateAdmin, async (req, res) => {
    const updates = req.body;
    try {
        for (const [key, value] of Object.entries(updates)) {
            await db.execute(
                'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, value]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Error updating settings" });
    }
});

module.exports = router;
