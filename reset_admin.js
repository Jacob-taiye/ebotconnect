const db = require('./config/db');
const bcrypt = require('bcryptjs');

async function resetAdmin() {
  try {
    const hashedPw = await bcrypt.hash('admin123', 10);
    await db.execute(
      "INSERT INTO admins (username, email, password) VALUES ('admin', 'admin@ebotconnect.com', ?) " +
      "ON DUPLICATE KEY UPDATE password = ?, email = 'admin@ebotconnect.com'",
      [hashedPw, hashedPw]
    );
    console.log('✓ Admin credentials reset successfully!');
    console.log('Email: admin@ebotconnect.com');
    console.log('Password: admin123');
    process.exit(0);
  } catch (err) {
    console.error('Failed to reset admin:', err);
    process.exit(1);
  }
}

resetAdmin();
