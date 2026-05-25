const axios = require('axios');
const nodemailer = require('nodemailer');
const logger = require('./logger');

// ─── EMAIL SENDER (RESEND + NODEMAILER FALLBACK) ──────────────────────────────

const FROM = () => process.env.EMAIL_FROM || 'Connect Freelance <noreply@connectfreelance.in>';

// Setup Nodemailer Transport (using Gmail App Password from .env)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendEmail = async ({ to, subject, html }) => {
    // 1. Try Resend First
    if (process.env.RESEND_API_KEY) {
        try {
            const res = await axios.post('https://api.resend.com/emails', {
                from: FROM(),
                to: Array.isArray(to) ? to : [to],
                subject,
                html,
            }, {
                headers: {
                    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            });
            logger.info(`[Email] Sent via Resend "${subject}" to ${to} — id: ${res.data?.id}`);
            return res.data;
        } catch (err) {
            logger.warn(`[Email] Resend failed for ${to} (${err.response?.data?.message || err.message}). Falling back to Nodemailer...`);
        }
    }

    // 2. Fallback to Nodemailer (Gmail)
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        logger.error(`[Email] Both Resend and Nodemailer are unavailable. Skipping email to ${to}`);
        return;
    }

    try {
        const info = await transporter.sendMail({
            from: `"Connect Freelance" <${process.env.EMAIL_USER}>`,
            to: Array.isArray(to) ? to.join(', ') : to,
            subject,
            html,
        });
        logger.info(`[Email] Sent via Nodemailer "${subject}" to ${to} — id: ${info.messageId}`);
        return info;
    } catch (err) {
        logger.error(`[Email] Nodemailer fallback failed for ${to}:`, err.message);
        throw err;
    }
};

const buildStandardEmail = (content) => {
    const frontendUrl = process.env.FRONTEND_URL || 'https://connectfreelance.in';
    return `<!DOCTYPE html>
<html>
<head>
<style>
  .dark-logo { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .light-logo { display: none !important; }
    .dark-logo { display: inline-block !important; }
    .email-bg { background-color: #111827 !important; }
    .email-card { background-color: #1f2937 !important; border-color: #374151 !important; }
    .text-main { color: #f9fafb !important; }
    .text-muted { color: #9ca3af !important; }
    .footer-logo-light { display: none !important; }
    .footer-logo-dark { display: inline-block !important; filter: brightness(0) invert(1); }
    .otp-box { background-color: #111827 !important; border-color: #374151 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;">
<div class="email-bg" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f9fafb;padding:40px 20px;color:#374151;">
  <div style="text-align:center;margin-bottom:32px;">
    <img src="${frontendUrl}/Logo-LightMode-trimmed.png" alt="Connect" height="56" class="light-logo" style="object-fit:contain; border:none; outline:none;" />
    <!--[if !mso]><!---->
    <img src="${frontendUrl}/Logo2.png" alt="Connect" height="56" class="dark-logo" style="object-fit:contain; border:none; outline:none; display:none;" />
    <!--<![endif]-->
  </div>
  <div class="email-card" style="max-width:540px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:40px;">
    ${content}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 32px 0;">
    <div style="text-align:center;margin-bottom:16px;">
      <img src="${frontendUrl}/WhatsApp_Image_2026-05-20_at_20.28.16-removebg-preview.png" alt="from Connect" height="40" class="footer-logo-light" style="object-fit:contain; border:none; outline:none;" />
      <!--[if !mso]><!---->
      <img src="${frontendUrl}/WhatsApp_Image_2026-05-20_at_20.28.16-removebg-preview.png" alt="from Connect" height="40" class="footer-logo-dark" style="object-fit:contain; border:none; outline:none; display:none;" />
      <!--<![endif]-->
    </div>
    <p class="text-muted" style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">© ${new Date().getFullYear()} Connect Freelance. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
};

// ─── OTP EMAIL ────────────────────────────────────────────────────────────────

exports.sendOTPEmail = async (toEmail, otp, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Your Connect Verification Code',
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello ${name || 'User'},</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#111827;">Your verification code is:</p>
                <div class="otp-box" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#0ea5e9;margin-bottom:24px;">${otp}</div>
                <p class="text-muted" style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6b7280;">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
            `),
        });
    } catch (err) {
        logger.error(`[Email] OTP send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

exports.sendDeleteAccountOTPEmail = async (toEmail, otp, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Confirm Account Deletion - Verification Code',
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello ${name || 'User'},</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#111827;">You have requested to permanently delete your Connect Freelance account. Enter the following verification code to confirm:</p>
                <div class="otp-box" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#ef4444;margin-bottom:24px;">${otp}</div>
                <p class="text-muted" style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6b7280;">Expires in 10 minutes. If you did not make this request, please change your password immediately to secure your account.</p>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Delete OTP send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── WELCOME EMAIL ────────────────────────────────────────────────────────────

exports.sendWelcomeEmail = async (toEmail, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Welcome to Connect Freelance!',
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hi ${name || 'there'},</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 32px;color:#111827;">You're now part of Connect Freelance — India's growing freelance marketplace.</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="https://connectfreelance.in/dashboard" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">Go to Dashboard</a>
                </div>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Welcome send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── PASSWORD RESET EMAIL ─────────────────────────────────────────────────────

exports.sendPasswordResetEmail = async (toEmail, resetLink, name = 'User') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Reset your Connect Freelance password',
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello ${name},</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 32px;color:#111827;">We received a request to reset the password for your Connect Freelance account. You can reset your password by clicking the button below.</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="${resetLink}" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">Reset Password</a>
                </div>
                <p class="text-muted" style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6b7280;">This link will expire in 24 hours. If you didn't request a password reset, you can safely ignore this email and your password will remain unchanged.</p>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Password reset send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── EMAIL VERIFICATION LINK ──────────────────────────────────────────────────

exports.sendVerificationLinkEmail = async (toEmail, verifyLink, name = 'User', isResend = false) => {
    try {
        const subject = isResend 
            ? 'Reminder: Verify your Connect Freelance email address' 
            : 'Verify your Connect Freelance email address';
            
        await sendEmail({
            to: toEmail,
            subject: subject,
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello ${name},</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 32px;color:#111827;">Please verify your email address to activate your Connect Freelance account.</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="${verifyLink}" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">Verify Email</a>
                </div>
                <p class="text-muted" style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6b7280;">If you didn't create an account, you can safely ignore this email.</p>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Verification link send failed to ${toEmail}:`, err?.response?.data || err.message);
        throw err;
    }
};

// ─── VERIFICATION REMINDER EMAIL ─────────────────────────────────────────────

exports.sendVerificationReminderEmail = async (toEmail, name = 'User', role = 'user') => {
    const roleLabel = role.toLowerCase() === 'client' ? 'client' : 'freelancer';
    const verificationUrl = 'https://connectfreelance.in/kyc';

    await sendEmail({
        to: toEmail,
        subject: 'Complete Your Account Verification – Connect Freelance',
        html: buildStandardEmail(`
            <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 8px;color:#111827;">Hello ${name},</p>
            <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 20px;color:#111827;">
                Your <strong>${roleLabel} account</strong> verification is still incomplete. Complete your identity verification to unlock all platform features and build trust with ${roleLabel === 'client' ? 'freelancers' : 'clients'}.
            </p>
            <div style="text-align:center;margin:32px 0;">
                <a href="${verificationUrl}" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">Complete Verification</a>
            </div>
            <p class="text-muted" style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6b7280;">Automated reminder · If already verified, ignore this email.</p>
        `),
    });
};

// ─── NOTIFICATION EMAILS ──────────────────────────────────────────────────────

exports.sendProposalEmail = async (toEmail, jobTitle, freelancerName) => {
    try {
        await sendEmail({
            to: toEmail,
            subject: `New Proposal on your job: ${jobTitle}`,
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello,</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 32px;color:#111827;">Good news! <strong>${freelancerName}</strong> has just submitted a proposal for your job <strong>"${jobTitle}"</strong>.</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="https://connectfreelance.in/dashboard/jobs" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">Review Proposal</a>
                </div>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Proposal send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

exports.sendMessageEmail = async (toEmail, senderName) => {
    try {
        await sendEmail({
            to: toEmail,
            subject: `New message from ${senderName}`,
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello,</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 32px;color:#111827;">You have a new direct message from <strong>${senderName}</strong> on Connect Freelance.</p>
                <div style="text-align:center;margin:32px 0;">
                    <a href="https://connectfreelance.in/dashboard/messages" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">View Message</a>
                </div>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Message send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

exports.sendContractUpdateEmail = async (toEmail, contractTitle, updateType, details = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: `Contract Update: ${contractTitle}`,
            html: buildStandardEmail(`
                <p class="text-main" style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#111827;">Hello,</p>
                <p class="text-main" style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#111827;">There is an update on your contract: <strong>${contractTitle}</strong>.</p>
                <div class="otp-box" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:20px;margin-bottom:24px;">
                    <p class="text-main" style="font-size:15px;margin:0 0 8px;color:#111827;"><strong>Update:</strong> ${updateType}</p>
                    ${details ? `<p class="text-muted" style="font-size:14px;margin:0;color:#6b7280;">${details}</p>` : ''}
                </div>
                <div style="text-align:center;margin:32px 0;">
                    <a href="https://connectfreelance.in/dashboard/contracts" style="display:inline-block;background-color:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px;">View Contract</a>
                </div>
            `),
        });
    } catch (err) {
        logger.error(`[Email] Contract update send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};
