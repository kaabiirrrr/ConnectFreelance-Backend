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


// ─── VERIFICATION REMINDER EMAIL ─────────────────────────────────────────────
exports.sendVerificationReminderEmail = async (toEmail, name = 'User', role = 'user') => {
    try {
        if (!isEmailConfigured()) {
            logger.warn(`[Email] Dev mode — reminder would go to ${toEmail}`);
            return;
        }

        const roleLabel = role.toLowerCase() === 'client' ? 'client' : 'freelancer';
        const verificationUrl = 'https://connectfreelance.in/kyc';

        await getTransporter().sendMail({
            from: process.env.EMAIL_FROM || 'Connect Freelance <noreply@connectfreelance.in>',
            to: toEmail,
            subject: 'Complete Your Account Verification – Connect Freelance',
            html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#0F172A;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F172A;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1E293B;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">Connect Freelance</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Verification Required</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Hello,</p>
            <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 20px;font-weight:700;">${name}</h2>
            <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">
              Your <strong style="color:#e2e8f0;">${roleLabel} account</strong> verification is still 
              <strong style="color:#f59e0b;">incomplete</strong> on Connect Freelance.
            </p>
            <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">
              To unlock all platform features and build trust with ${roleLabel === 'client' ? 'freelancers' : 'clients'}, 
              please complete your identity verification as soon as possible.
            </p>
            <!-- Benefits -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.2);border-radius:12px;margin-bottom:28px;">
              <tr><td style="padding:20px 24px;">
                <p style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Why verify?</p>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 8px;">✅ &nbsp;Unlock full platform access</p>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 8px;">✅ &nbsp;Build trust with ${roleLabel === 'client' ? 'freelancers' : 'clients'}</p>
                <p style="color:#94a3b8;font-size:13px;margin:0;">✅ &nbsp;Secure your account identity</p>
              </td></tr>
            </table>
            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <a href="${verificationUrl}" 
                   style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
                  Complete Verification →
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="color:#475569;font-size:12px;margin:0;">
              This is an automated reminder from Connect Freelance.<br/>
              If you've already completed verification, please ignore this email.
            </p>
            <p style="color:#334155;font-size:11px;margin:12px 0 0;">
              © ${new Date().getFullYear()} Connect Freelance · connectfreelance.in
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        });

        logger.info(`[Email] Verification reminder sent to ${toEmail}`);
    } catch (error) {
        handleEmailError(error, 'verification-reminder', toEmail);
        throw error;
    }
};
