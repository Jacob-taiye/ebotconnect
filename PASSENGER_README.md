# Namecheap Shared Hosting (Stellar) Setup Guide

This version of EbotConnect is optimized for deployment via the **cPanel Node.js Selector**.

### 1. Upload Instructions
- Zip the contents of this folder (`ebotconnect_shared`) and upload it to your Namecheap File Manager.
- Unzip it in a folder like `/home/yourusername/ebotconnect`.

### 2. cPanel Configuration
- Log in to cPanel and search for **"Setup Node.js App"**.
- Click **"Create Application"**.
- **Node.js version**: Choose the latest stable version (e.g., 18.x or 20.x).
- **Application mode**: Production.
- **Application root**: `ebotconnect` (the folder where you unzipped the files).
- **Application URL**: Your domain or a subdomain (e.g., `bot.yourdomain.com`).
- **Application startup file**: `server.js`.
- Click **"Create"**.

### 3. Environment Variables
In the Node.js App settings in cPanel, add the following variables:
- `GROQ_API_KEY`: [Your Key]
- `FLW_PUBLIC_KEY`: [Your Key]
- `FLW_SECRET_KEY`: [Your Key]
- `JWT_SECRET`: [Random String]
- `DB_HOST`: `localhost`
- `DB_USER`: [Your cPanel DB Username]
- `DB_PASS`: [Your cPanel DB Password]
- `DB_NAME`: [Your cPanel DB Name]

### 4. Database Setup
- Use **cPanel > MySQL Databases** to create a database and user.
- Import the `database/schema.sql` and run `database/admin_setup.js` once to seed the admin.

### 5. CRITICAL: Keeping the App Alive
Shared hosting will try to "sleep" your app. To prevent this:
- Create a **Cron Job** in cPanel that runs every 5 minutes.
- Command: `curl -s https://your-app-url.com/api/test > /dev/null`
- This "pings" your app to keep it from being killed by the server.

### 6. Limitations
- **Socket.io**: Real-time QR code updates might be slightly slower on shared hosting; if the QR doesn't show, refresh the page.
- **RAM**: If the app crashes with multiple users, you must upgrade to a VPS.
