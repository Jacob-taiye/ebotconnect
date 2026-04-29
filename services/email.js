const nodemailer = require('nodemailer');
const { welcomeTemplate, subscriptionSuccessTemplate, expirationTemplate } = require('./emailTemplates');
require('dotenv').config();

// Create transporter only if config exists, otherwise use a dummy or null
let transporter = null;

try {
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'mail.privateemail.com',
            port: process.env.EMAIL_PORT || 465,
            secure: process.env.EMAIL_PORT ? (process.env.EMAIL_PORT == 465) : true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        // Verify connection silently
        transporter.verify((error) => {
            if (error) console.warn('[EMAIL] Warning: SMTP connection failed. Emails may not send.', error.message);
            else console.log('[EMAIL] SMTP Server is ready');
        });
    } else {
        console.warn('[EMAIL] Warning: EMAIL_USER or EMAIL_PASS missing. Email service disabled.');
    }
} catch (e) {
    console.error('[EMAIL] Initialization Error:', e.message);
}

const sendWelcomeEmail = async (email, businessName) => {
    if (!transporter) return console.log(`[EMAIL] Skipped Welcome to ${email} (Service disabled)`);
    try {
        await transporter.sendMail({
            from: `"EbotConnect" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Welcome to EbotConnect! 🚀",
            html: welcomeTemplate(businessName),
        });
        console.log(`[EMAIL] Welcome email sent to ${email}`);
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send welcome email to ${email}:`, error.message);
    }
};

const sendSubscriptionSuccessEmail = async (email, businessName, planName, expiryDate) => {
    if (!transporter) return console.log(`[EMAIL] Skipped Success to ${email} (Service disabled)`);
    try {
        await transporter.sendMail({
            from: `"EbotConnect" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Subscription Activated! ✅",
            html: subscriptionSuccessTemplate(businessName, planName, expiryDate),
        });
        console.log(`[EMAIL] Subscription success email sent to ${email}`);
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send subscription email to ${email}:`, error.message);
    }
};

const sendExpirationEmail = async (email, businessName) => {
    if (!transporter) return console.log(`[EMAIL] Skipped Expiration to ${email} (Service disabled)`);
    try {
        await transporter.sendMail({
            from: `"EbotConnect" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Subscription Expired ⚠️",
            html: expirationTemplate(businessName),
        });
        console.log(`[EMAIL] Expiration email sent to ${email}`);
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send expiration email to ${email}:`, error.message);
    }
};

module.exports = { sendWelcomeEmail, sendSubscriptionSuccessEmail, sendExpirationEmail };
