const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
};

const tables = [
    `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        business_name VARCHAR(255), 
        email VARCHAR(255) UNIQUE, 
        password VARCHAR(255), 
        phone VARCHAR(20), 
        address TEXT, 
        logo VARCHAR(255), 
        status ENUM('active', 'suspended') DEFAULT 'active', 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        user_id INT, 
        plan_name VARCHAR(100), 
        amount DECIMAL(10, 2), 
        status ENUM('active', 'inactive', 'expired') DEFAULT 'inactive', 
        start_date DATETIME, 
        expiry_date DATETIME, 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS business_info (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        user_id INT, 
        description TEXT, 
        products TEXT, 
        prices TEXT, 
        faqs TEXT, 
        working_hours VARCHAR(255), 
        welcome_message TEXT, 
        auto_reply_message TEXT, 
        is_active BOOLEAN DEFAULT TRUE, 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        user_id INT NOT NULL, 
        session_key VARCHAR(255) NOT NULL, 
        session_data LONGTEXT, 
        status ENUM('connected', 'disconnected') DEFAULT 'disconnected', 
        connected_at DATETIME, 
        PRIMARY KEY (user_id, session_key), 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        user_id INT, 
        customer_number VARCHAR(20), 
        message TEXT, 
        bot_reply TEXT, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        username VARCHAR(255) UNIQUE, 
        email VARCHAR(255) UNIQUE, 
        password VARCHAR(255), 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS platform_settings (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        setting_key VARCHAR(100) UNIQUE, 
        setting_value TEXT, 
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`
];

async function setup() {
    let connection;
    try {
        console.log('Connecting to Aiven MySQL...');
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected! Creating tables...');

        for (const sql of tables) {
            await connection.execute(sql);
        }

        console.log('✓ All tables created successfully!');
        process.exit(0);
    } catch (err) {
        console.error('× Setup failed:', err.message);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

setup();
