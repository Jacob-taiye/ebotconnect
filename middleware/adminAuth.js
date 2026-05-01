const jwt = require('jsonwebtoken');

const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "No token provided" });

    let secret = process.env.JWT_SECRET;
    if (!secret || secret === "" || secret === "undefined") {
        secret = "ebotconnect_default_secret_key_2024";
    }

    jwt.verify(token, secret, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid token" });
        if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
        req.user = user;
        next();
    });
};

module.exports = authenticateAdmin;
