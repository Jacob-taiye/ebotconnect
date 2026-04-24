const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function setup() {
    try {
        console.log('Starting Admin Setup...');

        // 1. Create Admins Table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Admins table ready');

        // 2. Create Platform Settings Table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS platform_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                setting_key VARCHAR(100) UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Platform settings table ready');

        // 3. Add status to users
        try {
            await db.execute(`ALTER TABLE users ADD COLUMN status ENUM('active', 'suspended') DEFAULT 'active'`);
            console.log('✓ User status column added');
        } catch (e) {
            console.log('i User status column already exists');
        }

        // 4. Create Default Admin
        const [existing] = await db.execute('SELECT id FROM admins WHERE username = "admin"');
        if (existing.length === 0) {
            const hashedPw = await bcrypt.hash('admin123', 10);
            await db.execute(
                'INSERT INTO admins (username, email, password) VALUES (?, ?, ?)',
                ['admin', 'admin@ebotconnect.com', hashedPw]
            );
            console.log('✓ Default admin created (admin / admin123)');
        }

        // 5. Seed Default Settings
        const settings = [
            ['flw_public_key', ''],
            ['flw_secret_key', ''],
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
        console.log('✓ Default settings seeded');

        process.exit(0);
    } catch (err) {
        console.error('Setup failed:', err);
        process.exit(1);
    }
}

setup();
