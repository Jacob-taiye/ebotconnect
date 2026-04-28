const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = function(req, res, next) {
    // Check for Authorization header
    const authHeader = req.header('Authorization');
    
    // Check if no token or doesn't start with Bearer
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Extract the token
    const token = authHeader.split(' ')[1];

    // Verify token
    try {
        let secret = process.env.JWT_SECRET;
        if (!secret || secret === "" || secret === "undefined") {
            secret = "ebotconnect_default_secret_key_2024";
        }
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};
