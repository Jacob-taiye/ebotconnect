const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { sendSubscriptionSuccessEmail } = require('../services/email');

const FLW_SECRET = process.env.FLW_SECRET_KEY;
const FLW_PUBLIC = process.env.FLW_PUBLIC_KEY;

// 1. Initialize Transaction (Provide keys & ref to frontend)
router.post('/initialize', authenticateToken, async (req, res) => {
    try {
        const { planName, amount } = req.body;
        const userId = req.user.userId;

        // Get user details
        const [user] = await db.execute('SELECT email, business_name FROM users WHERE id = ?', [userId]);
        if (!user.length) return res.status(404).json({ message: "User not found" });

        const reference = `EBOT-FLW-${Date.now()}-${userId}`;

        res.json({
            publicKey: FLW_PUBLIC,
            email: user[0].email,
            businessName: user[0].business_name,
            reference: reference
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Initialization failed" });
    }
});

// 2. Verify Transaction
router.post('/verify', authenticateToken, async (req, res) => {
    const { transaction_id, reference } = req.body;
    try {
        const response = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
            headers: { Authorization: `Bearer ${FLW_SECRET}` }
        });

        const data = response.data.data;

        // Validation: Status must be successful, currency NGN, and reference must match
        if (data.status === 'successful' && data.currency === 'NGN' && data.tx_ref === reference) {
            await updateSubscription(req.user.userId, data);
            return res.json({ status: 'success' });
        }

        res.status(400).json({ message: "Payment verification failed" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Verification error" });
    }
});

// 3. Webhook (For async confirmation)
router.post('/webhook', async (req, res) => {
    // Flutterwave secret hash check
    const secretHash = process.env.FLW_SECRET_HASH; // Set this in your FLW dashboard and .env
    const signature = req.headers['verif-hash'];

    if (!signature || (signature !== secretHash)) {
        return res.status(401).end();
    }

    const payload = req.body;
    if (payload.status === 'successful') {
        const userId = payload.tx_ref.split('-').pop();
        await updateSubscription(userId, payload);
    }

    res.status(200).end();
});

async function updateSubscription(userId, data) {
    const amount = data.amount;

    // Fetch dynamic pricing from platform_settings
    const [settings] = await db.execute('SELECT setting_key, setting_value FROM platform_settings');
    const pricing = {};
    settings.forEach(s => pricing[s.setting_key] = parseInt(s.setting_value));

    let planName = 'Basic';
    if (amount >= (pricing.price_enterprise || 30000)) planName = 'Enterprise';
    else if (amount >= (pricing.price_pro || 15000)) planName = 'Pro';

    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1);

    // Safely update or insert subscription
    const [existing] = await db.execute('SELECT id FROM subscriptions WHERE user_id = ?', [userId]);
    if (existing.length > 0) {
        await db.execute(
            `UPDATE subscriptions SET plan_name=?, amount=?, status='active', start_date=?, expiry_date=? WHERE user_id=?`,
            [planName, amount, startDate, expiryDate, userId]
        );
    } else {
        await db.execute(
            `INSERT INTO subscriptions (user_id, plan_name, amount, status, start_date, expiry_date) 
             VALUES (?, ?, ?, 'active', ?, ?)`,
            [userId, planName, amount, startDate, expiryDate]
        );
    }

    // Ensure bot is enabled after payment
    await db.execute('UPDATE business_info SET is_active = 1 WHERE user_id = ?', [userId]);

    // Send Success Email
    try {
        const [user] = await db.execute('SELECT email, business_name FROM users WHERE id = ?', [userId]);
        if (user.length > 0) {
            sendSubscriptionSuccessEmail(user[0].email, user[0].business_name, planName, expiryDate);
        }
    } catch (e) {
        console.error('[EMAIL ERROR] Failed to fetch user for success email:', e.message);
    }
}

module.exports = router;