const welcomeTemplate = (businessName) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #171c1e; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeff1; border-radius: 12px; }
        .header { background: #00687b; color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { padding: 30px; background: #ffffff; }
        .button { background: #00687b; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #416874; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to EbotConnect!</h1>
        </div>
        <div class="content">
            <p>Hi ${businessName},</p>
            <p>We're thrilled to have you on board! Your AI-powered WhatsApp bot is just a few steps away from being live.</p>
            <p>With EbotConnect, you can:</p>
            <ul>
                <li>Automate customer replies with AI.</li>
                <li>Manage business info and FAQs.</li>
                <li>Connect your WhatsApp account in seconds.</li>
            </ul>
            <p style="text-align: center; margin-top: 30px;">
                <a href="https://ebotconnect.com/login" class="button">Go to Dashboard</a>
            </p>
        </div>
        <div class="footer">
            &copy; 2026 EbotConnect. All rights reserved.
        </div>
    </div>
</body>
</html>
`;

const subscriptionSuccessTemplate = (businessName, planName, expiryDate) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #171c1e; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeff1; border-radius: 12px; }
        .header { background: #22c55e; color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { padding: 30px; background: #ffffff; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #416874; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Subscription Active!</h1>
        </div>
        <div class="content">
            <p>Hi ${businessName},</p>
            <p>Your payment was successful and your <strong>${planName}</strong> plan is now active.</p>
            <p><strong>Expiry Date:</strong> ${new Date(expiryDate).toLocaleDateString()}</p>
            <p>Your WhatsApp bot is now fully operational and ready to serve your customers.</p>
        </div>
        <div class="footer">
            &copy; 2026 EbotConnect. All rights reserved.
        </div>
    </div>
</body>
</html>
`;

const expirationTemplate = (businessName) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #171c1e; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeff1; border-radius: 12px; }
        .header { background: #ef4444; color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { padding: 30px; background: #ffffff; }
        .button { background: #ef4444; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #416874; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Subscription Expired</h1>
        </div>
        <div class="content">
            <p>Hi ${businessName},</p>
            <p>Your EbotConnect subscription has expired, and your bot has been temporarily disabled.</p>
            <p>Don't let your customers wait! Renew your subscription now to reactivate your AI assistant.</p>
            <p style="text-align: center; margin-top: 30px;">
                <a href="https://ebotconnect.com/pricing" class="button">Renew Subscription</a>
            </p>
        </div>
        <div class="footer">
            &copy; 2026 EbotConnect. All rights reserved.
        </div>
    </div>
</body>
</html>
`;

module.exports = { welcomeTemplate, subscriptionSuccessTemplate, expirationTemplate };
