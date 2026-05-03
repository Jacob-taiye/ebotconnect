require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Add this BEFORE your other routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Pass io to express app
app.set('socketio', io);

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log(`[SOCKET] New connection: ${socket.id}`);

  socket.on('join', (room) => {
    console.log(`[SOCKET] Socket ${socket.id} joining room: ${room}`);
    socket.join(room);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] Socket ${socket.id} disconnected. Reason: ${reason}`);
  });

  socket.on('error', (error) => {
    console.error(`[SOCKET] Socket ${socket.id} error:`, error);
  });
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const paymentRoutes = require('./routes/payment');
const metaRoutes = require('./routes/meta');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp'); // New route for QR

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Auto-Database Setup for Cloud Deployment
const initializeDatabase = async () => {
  const db = require('./config/db');

  // 1. Core Tables Setup
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, business_name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), phone VARCHAR(20), address TEXT, logo VARCHAR(255), status ENUM('active', 'suspended') DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS subscriptions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, plan_name VARCHAR(100), amount DECIMAL(10, 2), status ENUM('active', 'inactive', 'expired') DEFAULT 'inactive', start_date DATETIME, expiry_date DATETIME, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS business_info (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, description TEXT, products TEXT, prices TEXT, faqs TEXT, working_hours VARCHAR(255), welcome_message TEXT, auto_reply_message TEXT, is_active BOOLEAN DEFAULT TRUE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS messages (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, customer_number VARCHAR(20), message TEXT, bot_reply TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS admins (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(255) UNIQUE, email VARCHAR(255) UNIQUE, password VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS platform_settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) UNIQUE, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, customer_number VARCHAR(20), order_details TEXT, status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS whatsapp_sessions (user_id INT PRIMARY KEY, status ENUM('connected', 'disconnected') DEFAULT 'disconnected', connected_at TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`
  ];

  try {
    for (const sql of tables) { await db.execute(sql); }

    // 2. Setup for social_connections (Meta API)
    try {
      await db.execute("SELECT status FROM social_connections LIMIT 1");
    } catch (e) {
      console.log('! Initializing social_connections table...');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS social_connections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL, 
          platform ENUM('whatsapp', 'instagram', 'messenger') NOT NULL, 
          access_token LONGTEXT, 
          account_id VARCHAR(255), 
          status ENUM('connected', 'disconnected') DEFAULT 'disconnected', 
          connected_at DATETIME, 
          UNIQUE KEY(user_id, platform),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }

    console.log('✓ Database tables initialized');

    // 3. Auto-Seed Default Admin
    const bcrypt = require('bcryptjs');
    const hashedPw = await bcrypt.hash('admin123', 10);
    await db.execute(
      "INSERT INTO admins (username, email, password) VALUES ('admin', 'admin@ebotconnect.com', ?) " +
      "ON DUPLICATE KEY UPDATE password = ?, email = 'admin@ebotconnect.com'",
      [hashedPw, hashedPw]
    );
    console.log('✓ Default admin ensured (admin@ebotconnect.com / admin123)');

    // 4. Seed Default Settings
    const settings = [
      ['price_basic', '5000'],
      ['price_pro', '15000'],
      ['price_enterprise', '30000']
    ];

    for (const [key, val] of settings) {
      await db.execute(
        'INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)',
        [key, val]
      );
    }
    console.log('✓ Default platform settings ensured');
  } catch (err) {
    console.error('! Database initialization warning:', err.message);
  }
};
initializeDatabase();

// Background Task: Check for expired subscriptions every hour
const db = require('./config/db');
const { sendExpirationEmail } = require('./services/email');

setInterval(async () => {
  try {
    console.log('Checking for expired subscriptions...');
    const [expired] = await db.execute(
      `SELECT user_id FROM subscriptions WHERE expiry_date < NOW() AND status = 'active'`
    );

    for (const sub of expired) {
      await db.execute(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ?`, [sub.user_id]);
      await db.execute(`UPDATE business_info SET is_active = 0 WHERE user_id = ?`, [sub.user_id]);

      // Send Expiration Email
      try {
        const [user] = await db.execute('SELECT email, business_name FROM users WHERE id = ?', [sub.user_id]);
        if (user.length > 0) {
          sendExpirationEmail(user[0].email, user[0].business_name);
        }
      } catch (e) {
        console.error('[EMAIL ERROR] Failed to send expiration email:', e.message);
      }

      console.log(`Subscription expired for user ${sub.user_id}. Bot disabled.`);
    }
  } catch (err) {
    console.error('Error in subscription check task:', err);
  }
}, 1000 * 60 * 60); // 1 hour

// Test Route
app.get('/api/test', (req, res) => {
  res.json({ message: "EbotConnect API is running!" });
});

// Port
const PORT = process.env.PORT || 3000;

// Start Server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Catch-all route to serve index.html for any non-API requests
app.use((req, res) => {
  // If the request is for an API or has an extension (like .js, .css), don't serve index.html
  if (req.path.startsWith('/api/') || req.path.includes('/socket.io/') || req.path.includes('.')) {
    return res.status(404).json({ message: "Not found" });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export io for other modules
module.exports = { app, server, io };

// --- Auto-Initialize WhatsApp Sessions ---
const { initializeWhatsApp } = require('./services/whatsapp');
const startWhatsAppSessions = async () => {
  try {
    const [rows] = await db.execute('SELECT user_id FROM whatsapp_sessions WHERE status = "connected"');
    console.log(`[BOOT] Resuming ${rows.length} WhatsApp sessions...`);
    for (const row of rows) {
      initializeWhatsApp(row.user_id, io);
    }
  } catch (err) {
    console.error('[BOOT ERROR] Failed to resume WhatsApp sessions:', err.message);
  }
};

// Wait a bit for DB to initialize then start sessions
setTimeout(startWhatsAppSessions, 5000);
