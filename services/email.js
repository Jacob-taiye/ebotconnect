const nodemailer = require('nodemailer');
const { welcomeTemplate, subscriptionSuccessTemplate, expirationTemplate } = require('./emailTemplates');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendWelcomeEmail = async (email, businessName) => {
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
