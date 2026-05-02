require('dotenv').config();
const db = require('./config/db');

async function testDB() {
    try {
        console.log("Checking social_connections table...");
        const [rows] = await db.execute("DESCRIBE social_connections");
        console.log("Table exists:", rows);
        
        // Mock insert
        console.log("Attempting mock insert...");
        await db.execute(
            `INSERT INTO social_connections (user_id, platform, access_token, account_id, status, connected_at)
             VALUES (?, ?, ?, ?, 'connected', NOW())
             ON DUPLICATE KEY UPDATE access_token = ?, account_id = ?, status = 'connected', connected_at = NOW()`,
            [1, 'messenger', 'test_token', '12345', 'test_token', '12345']
        );
        console.log("Insert successful!");
    } catch (err) {
        console.error("DB Error:", err);
    } finally {
        process.exit();
    }
}

testDB();
