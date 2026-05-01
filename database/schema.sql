
-- 1) Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  logo VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  plan_name VARCHAR(100),
  amount DECIMAL(10, 2),
  status ENUM('active', 'inactive', 'expired') DEFAULT 'inactive',
  start_date DATETIME,
  expiry_date DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3) Business Info table (for bot context)
CREATE TABLE IF NOT EXISTS business_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  description TEXT,
  products TEXT, -- Store as JSON or Text
  prices TEXT,   -- Store as JSON or Text
  faqs TEXT,     -- Store as JSON or Text
  working_hours VARCHAR(255),
  welcome_message TEXT,
  auto_reply_message TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4) WhatsApp Sessions table
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  session_data LONGTEXT, -- To store Baileys authentication state
  status ENUM('connected', 'disconnected') DEFAULT 'disconnected',
  connected_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5) Messages table (for logs)
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  customer_number VARCHAR(20),
  message TEXT,
  bot_reply TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
