const db = require('../config/db');

const apiAuth = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing in x-api-key header' });
  }

  try {
    // Check if the API key is valid and active
    const [keys] = await db.execute(
      'SELECT user_id FROM api_keys WHERE api_key = ? AND status = "active"',
      [apiKey]
    );

    if (keys.length === 0) {
      return res.status(403).json({ error: 'Invalid or revoked API key' });
    }

    const userId = keys[0].user_id;

    // Check if the user has an active Premium subscription
    const [subs] = await db.execute(
      'SELECT id FROM subscriptions WHERE user_id = ? AND status = "active" AND plan_name = "Premium" AND expiry_date >= NOW()',
      [userId]
    );

    if (subs.length === 0) {
      return res.status(403).json({ error: 'An active Premium subscription is required for API access' });
    }

    // Attach user_id to the request
    req.user_id = userId;
    next();
  } catch (error) {
    console.error('[API Auth Error]', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

module.exports = apiAuth;
