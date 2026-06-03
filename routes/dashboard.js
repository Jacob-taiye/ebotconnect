const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// Get Dashboard Stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Fetch user business name
    const [user] = await db.execute('SELECT business_name FROM users WHERE id = ?', [userId]);
    
    // Fetch subscription status
    const [subs] = await db.execute('SELECT plan_name, status, expiry_date FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    
    // Fetch Social Connections status
    const [connections] = await db.execute("SELECT platform FROM social_connections WHERE user_id = ? AND status = 'connected'", [userId]);
    const connectedPlatforms = connections.map(c => c.platform);
    
    // Fetch Message Count
    const [msgCount] = await db.execute('SELECT COUNT(*) as count FROM messages WHERE user_id = ?', [userId]);
    
    // Fetch Bot Active state
    const [botInfo] = await db.execute('SELECT is_active FROM business_info WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);

    // Fetch Recent Activity (latest 5 messages)
    const [recentActivity] = await db.execute(
      'SELECT customer_number, message, created_at FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [userId]
    );

    res.json({
      businessName: user[0]?.business_name || 'Business',
      subscription: {
        status: subs[0]?.status || 'inactive',
        plan: subs[0]?.plan_name || 'N/A',
        expiryDate: subs[0]?.expiry_date || null
      },
      social: {
        platforms: connectedPlatforms,
        count: connectedPlatforms.length
      },
      messageCount: msgCount[0]?.count || 0,
      botActive: botInfo.length > 0 ? (botInfo[0].is_active === 1) : false,
      recentActivity: recentActivity
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error fetching stats" });
  }
});

// Toggle Bot Active Status
router.post('/toggle-bot', authenticateToken, async (req, res) => {
  const { active } = req.body;
  const userId = req.user.userId;
  const isActive = active ? 1 : 0;
  
  try {
    const [existing] = await db.execute('SELECT id FROM business_info WHERE user_id = ?', [userId]);
    
    if (existing.length > 0) {
      await db.execute('UPDATE business_info SET is_active = ? WHERE user_id = ?', [isActive, userId]);
    } else {
      await db.execute('INSERT INTO business_info (user_id, is_active) VALUES (?, ?)', [userId, isActive]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Toggle Bot Error:', error);
    res.status(500).json({ message: "Error toggling bot" });
  }
});

// Get Profile Data
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const [profile] = await db.execute('SELECT * FROM business_info WHERE user_id = ?', [req.user.userId]);
    res.json(profile[0] || {});
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// Update Profile Data
router.post('/profile', authenticateToken, async (req, res) => {
  const { description, products, prices, faqs, working_hours, welcome_message, auto_reply_message } = req.body;
  try {
    // Check if profile exists
    const [existing] = await db.execute('SELECT id FROM business_info WHERE user_id = ?', [req.user.userId]);

    if (existing.length > 0) {
      // Update existing
      await db.execute(
        `UPDATE business_info SET 
         description=?, products=?, prices=?, faqs=?, working_hours=?, welcome_message=?, auto_reply_message=?
         WHERE user_id = ?`,
        [description, products, prices || '', faqs, working_hours, welcome_message, auto_reply_message, req.user.userId]
      );
    } else {
      // Insert new
      await db.execute(
        `INSERT INTO business_info 
         (user_id, description, products, prices, faqs, working_hours, welcome_message, auto_reply_message) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.userId, description, products, prices || '', faqs, working_hours, welcome_message, auto_reply_message]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Save Profile Error:', error);
    res.status(500).json({ message: "Error saving profile" });
  }
});

// Get Message Logs
router.get('/messages', authenticateToken, async (req, res) => {
  try {
    const [messages] = await db.execute(
      'SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.userId]
    );
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages" });
  }
});

// Get API Key Status
router.get('/api-keys', authenticateToken, async (req, res) => {
  try {
    const [keys] = await db.execute(
      "SELECT api_key, status, created_at FROM api_keys WHERE user_id = ? AND status = 'active' LIMIT 1",
      [req.user.userId]
    );
    res.json(keys[0] || null);
  } catch (error) {
    console.error('Fetch API Key Error:', error);
    res.status(500).json({ message: "Error fetching API key" });
  }
});

// Generate or Revoke API Key
router.post('/api-keys/generate', authenticateToken, async (req, res) => {
  const { action } = req.body; // 'generate' or 'revoke'
  const userId = req.user.userId;

  try {
    if (action === 'revoke') {
      await db.execute("UPDATE api_keys SET status = 'revoked' WHERE user_id = ?", [userId]);
      return res.json({ success: true, message: "API key revoked" });
    }

    if (action === 'generate') {
      const crypto = require('crypto');
      const newKey = 'ebot_' + crypto.randomBytes(24).toString('hex');
      
      // Revoke any existing active keys
      await db.execute("UPDATE api_keys SET status = 'revoked' WHERE user_id = ?", [userId]);
      
      // Insert new key
      await db.execute(
        "INSERT INTO api_keys (user_id, api_key, status) VALUES (?, ?, 'active')",
        [userId, newKey]
      );
      return res.json({ success: true, apiKey: newKey });
    }

    res.status(400).json({ message: "Invalid action" });
  } catch (error) {
    console.error('Generate API Key Error:', error);
    res.status(500).json({ message: "Error managing API key" });
  }
});

module.exports = router;