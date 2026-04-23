const nodemailer = require('nodemailer');
const logger = require('./logger');

// Create a more robust transporter configuration
const transporterConfig = {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // Add TLS options for better compatibility with Gmail
    tls: {
        rejectUnauthorized: false
    }
};

// Helper to check if email is configured
const isEmailConfigured = () => {
    return process.env.EMAIL_USER && process.env.EMAIL_PASS;
};

// Create transporter dynamically to pick up .env changes
const getTransporter = () => {
    const config = {
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false
        }
    };
    return nodemailer.createTransport(config);
};

// Common error handler
const handleEmailError = (error, type, toEmail) => {
    if (error.code === 'EAUTH') {
        logger.error(`[Email Service] AUTHENTICATION FAILED. 
        1. Ensure 2-Step Verification is ENABLED for ${process.env.EMAIL_USER}.
        2. Generate a NEW App Password and update EMAIL_PASS in .env.
        3. Do NOT use your regular Gmail password.`);
    } else {
        logger.error(`[Email Service] Failed to send ${type} to ${toEmail}`, error);
    }
};

exports.sendOTPEmail = async (toEmail, otp, name = '') => {
    try {
        if (!isEmailConfigured()) {
            logger.log(`[Email Service] Development Mode - To: ${toEmail} | Subject: Your Connect Verification Code | OTP: ${otp}`);
            return;
        }

        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: toEmail,
            subject: 'Your Connect Verification Code',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #333;">Verification Code</h2>
                    <p>Hello ${name || 'User'},</p>
                    <p>Your verification code for Connect is:</p>
                    <div style="background: #f4f4f4; padding: 15px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; color: #007bff;">
                        ${otp}
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                    <p>If you didn't request this, please ignore this email.</p>
                </div>
            `
        });
        logger.log(`[Email Service] OTP sent to ${toEmail}`);
    } catch (error) {
        handleEmailError(error, 'OTP', toEmail);
    }
};

exports.sendWelcomeEmail = async (toEmail, name = '') => {
    try {
        if (!isEmailConfigured()) {
            logger.log(`[Email Service] Development Mode - To: ${toEmail} | Subject: Welcome to Connect!`);
            return;
        }

        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: toEmail,
            subject: 'Welcome to Connect!',
            html: `<p>Welcome ${name || ''} to Connect!</p>`
        });
    } catch (error) {
        handleEmailError(error, 'Welcome Email', toEmail);
    }
};

exports.sendPasswordResetEmail = async (toEmail, resetLink) => {
    try {
        if (!isEmailConfigured()) {
            logger.log(`[Email Service] Development Mode - To: ${toEmail} | Subject: Reset your Connect password | Link: ${resetLink}`);
            return;
        }

        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: toEmail,
            subject: 'Reset your Connect password',
            html: `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`
        });
    } catch (error) {
        handleEmailError(error, 'Password Reset', toEmail);
    }
};

exports.sendVerificationLinkEmail = async (toEmail, verifyLink, name = '') => {
    try {
        if (!isEmailConfigured()) {
            logger.log(`[Email Service] Development Mode - Link: ${verifyLink}`);
            return;
        }

        const transporter = getTransporter();
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: toEmail,
            subject: 'Verify your Connect email address',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #333;">Verify Your Email</h2>
                    <p>Hello ${name || 'User'},</p>
                    <p>Please click the button below to verify your email address and activate your account:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verifyLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
                    </div>
                    <p style="color: #666; font-size: 12px;">Or copy and paste this link: <br> ${verifyLink}</p>
                </div>
            `
        });
        logger.log(`[Email Service] Verification link sent to ${toEmail}`);
    } catch (error) {
        handleEmailError(error, 'Verification Link', toEmail);
        throw error; // Re-throw to let the controller handle it
    }
};

