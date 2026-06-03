const db = require('./config/db');

async function test() {
  try {
    const [cols] = await db.execute("SHOW COLUMNS FROM api_keys");
    console.log("Table exists. Columns:");
    console.log(cols);
  } catch (e) {
    console.error("Error checking api_keys table:", e.message);
    
    // Try creating it if it doesn't exist to see the error
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS api_keys (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, api_key VARCHAR(255) UNIQUE, status ENUM('active', 'revoked') DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
      console.log("Table created manually.");
    } catch (e2) {
      console.error("Error creating table:", e2.message);
    }
  }
  process.exit();
}

test();
