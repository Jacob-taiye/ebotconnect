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
    methods: ["GET", "POST"]
  }
});

// Pass io to express app
app.set('socketio', io);

// Socket.io Connection Logic
io.on('connection', (socket) => {
  socket.on('join', (room) => {
    socket.join(room);
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
const whatsappRoutes = require('./routes/whatsapp');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/admin', adminRoutes);

// Background Task: Check for expired subscriptions every hour
const db = require('./config/db');
const { initializeWhatsApp } = require('./services/whatsapp');

const fs = require('fs');
// Auto-initialize active WhatsApp sessions on server start
setTimeout(async () => {
    try {
        const [activeSessions] = await db.execute('SELECT user_id FROM whatsapp_sessions WHERE status = "connected"');
        for (const session of activeSessions) {
            const sessionPath = path.join(__dirname, `./sessions/user_${session.user_id}`);
            if (session.user_id && fs.existsSync(sessionPath)) {
                console.log(`Auto-reconnecting WhatsApp for user ${session.user_id}...`);
                initializeWhatsApp(session.user_id, io);
            } else {
                // If files are missing, reset status to disconnected
                await db.execute('UPDATE whatsapp_sessions SET status = "disconnected" WHERE user_id = ?', [session.user_id]);
            }
        }
    } catch (err) {
        console.error('Error auto-initializing sessions:', err);
    }
}, 5000);

setInterval(async () => {
  try {
    console.log('Checking for expired subscriptions...');
    const [expired] = await db.execute(
      `SELECT user_id FROM subscriptions WHERE expiry_date < NOW() AND status = 'active'`
    );

    for (const sub of expired) {
      await db.execute(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ?`, [sub.user_id]);
      await db.execute(`UPDATE business_info SET is_active = 0 WHERE user_id = ?`, [sub.user_id]);
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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export io for other modules
module.exports = { app, server, io };
