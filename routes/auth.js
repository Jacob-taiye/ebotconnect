const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendWelcomeEmail } = require('../services/email');
require('dotenv').config();

// Register Route
router.post('/register', async (req, res) => {
    try {
        const { business_name, email, password, phone } = req.body;

        // Check if user exists
        const [existingUser] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert user
        const [result] = await db.execute(
            'INSERT INTO users (business_name, email, password, phone) VALUES (?, ?, ?, ?)',
            [business_name, email, hashedPassword, phone]
        );

        const userId = result.insertId;

        // Create default business info
        await db.execute(
            `INSERT INTO business_info (user_id, description, welcome_message, is_active) 
             VALUES (?, ?, ?, ?)`,
            [userId, `Welcome to ${business_name}!`, 'Hello! How can we help you today?', 1]
        );

        // Add 7-Day Free Trial
        const trialExpiry = new Date();
        trialExpiry.setDate(trialExpiry.getDate() + 7);
        await db.execute(
            `INSERT INTO subscriptions (user_id, plan_name, amount, status, start_date, expiry_date) 
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [userId, '7-Day Free Trial', 0.00, 'active', trialExpiry]
        );

        // Send Welcome Email (async, don't block response)
        sendWelcomeEmail(email, business_name);

        res.status(201).json({ message: 'User registered successfully with 7-day free trial', userId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during registration' });
    }
});

// Login Route
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const user = users[0];

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Generate JWT
        let secret = process.env.JWT_SECRET;
        if (!secret || secret === "" || secret === "undefined") {
            secret = "ebotconnect_default_secret_key_2024";
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            secret,
            { expiresIn: '1d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                business_name: user.business_name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('[LOGIN ERROR]:', error.message);
        res.status(500).json({ message: 'Server error during login', error: error.message });
    }
});

module.exports = router;
