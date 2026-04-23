require('dotenv').config();
const { sendVerificationLinkEmail } = require('../utils/emailService');
const logger = require('../utils/logger');

async function test() {
    console.log('--- Email Diagnostic Test ---');
    console.log('EMAIL_USER:', process.env.EMAIL_USER);
    console.log('EMAIL_HOST:', process.env.EMAIL_HOST);

    const testEmail = process.env.EMAIL_USER; // Send to self
    const testLink = 'http://localhost:5001/api/auth/verify-email?token=test-token&uid=test-uid';

    console.log(`Attempting to send test email to: ${testEmail}`);

    try {
        await sendVerificationLinkEmail(testEmail, testLink, 'Test User');
        console.log('✅ Success! Check your inbox (and spam folder).');
    } catch (error) {
        console.error('❌ Failed to send email:');
        console.dir(error);
    }
}

test();
