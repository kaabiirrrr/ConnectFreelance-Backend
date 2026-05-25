require('dotenv').config();
const { sendWelcomeEmail } = require('./utils/emailService');

async function testResend() {
    const testEmail = process.env.SUPER_ADMIN_EMAIL || 'lets.connectbro@gmail.com'; // Change this to your Resend account email if different
    console.log(`Sending test email to: ${testEmail}`);
    console.log(`Using Resend Key: ${process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.slice(0, 8) + '***' : 'MISSING'}`);
    
    try {
        await sendWelcomeEmail(testEmail, 'Test User');
        console.log('✅ Test email triggered successfully! Check your inbox.');
    } catch (error) {
        console.error('❌ Failed to send email:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

testResend();
