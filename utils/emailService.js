const axios = require('axios');
const logger = require('./logger');

// ─── RESEND SENDER ────────────────────────────────────────────────────────────

const FROM = () => process.env.EMAIL_FROM || 'Connect Freelance <onboarding@resend.dev>';

const sendEmail = async ({ to, subject, html }) => {
    if (!process.env.RESEND_API_KEY) {
        logger.warn(`[Email] RESEND_API_KEY not set — skipping email to ${to} | ${subject}`);
        return;
    }
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
    logger.info(`[Email] Sent "${subject}" to ${to} — id: ${res.data?.id}`);
    return res.data;
};

// ─── OTP EMAIL ────────────────────────────────────────────────────────────────

exports.sendOTPEmail = async (toEmail, otp, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Your Connect Verification Code',
            html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#0F172A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:28px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Connect Freelance</h1>
  </div>
  <div style="padding:40px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Hello ${name || 'User'},</p>
    <p style="color:#e2e8f0;font-size:15px;margin:0 0 24px;">Your verification code is:</p>
    <div style="background:#1E293B;border:1px solid rgba(14,165,233,0.3);border-radius:12px;padding:20px;text-align:center;font-size:36px;font-weight:900;letter-spacing:10px;color:#38bdf8;">${otp}</div>
    <p style="color:#64748b;font-size:13px;margin:20px 0 0;">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
  </div>
</div>`,
        });
    } catch (err) {
        logger.error(`[Email] OTP send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── WELCOME EMAIL ────────────────────────────────────────────────────────────

exports.sendWelcomeEmail = async (toEmail, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Welcome to Connect Freelance!',
            html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#0F172A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:28px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Welcome to Connect Freelance!</h1>
  </div>
  <div style="padding:40px;">
    <p style="color:#e2e8f0;font-size:16px;">Hi ${name || 'there'},</p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;">You're now part of Connect Freelance — India's growing freelance marketplace.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="https://connectfreelance.in/dashboard" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;">Go to Dashboard →</a>
    </div>
    <p style="color:#475569;font-size:12px;text-align:center;">© ${new Date().getFullYear()} Connect Freelance · connectfreelance.in</p>
  </div>
</div>`,
        });
    } catch (err) {
        logger.error(`[Email] Welcome send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── PASSWORD RESET EMAIL ─────────────────────────────────────────────────────

exports.sendPasswordResetEmail = async (toEmail, resetLink) => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Reset your Connect Freelance password',
            html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#0F172A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:28px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Password Reset</h1>
  </div>
  <div style="padding:40px;">
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">Click the button below to reset your password. This link expires in 24 hours.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${resetLink}" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;">Reset Password →</a>
    </div>
    <p style="color:#64748b;font-size:13px;">If you didn't request this, ignore this email. Your password won't change.</p>
    <p style="color:#475569;font-size:12px;text-align:center;margin-top:24px;">© ${new Date().getFullYear()} Connect Freelance · connectfreelance.in</p>
  </div>
</div>`,
        });
    } catch (err) {
        logger.error(`[Email] Password reset send failed to ${toEmail}:`, err?.response?.data || err.message);
    }
};

// ─── EMAIL VERIFICATION LINK ──────────────────────────────────────────────────

exports.sendVerificationLinkEmail = async (toEmail, verifyLink, name = '') => {
    try {
        await sendEmail({
            to: toEmail,
            subject: 'Verify your Connect Freelance email address',
            html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#0F172A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:28px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Verify Your Email</h1>
  </div>
  <div style="padding:40px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Hello ${name || 'User'},</p>
    <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 28px;">Please verify your email address to activate your Connect Freelance account.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${verifyLink}" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;">Verify Email →</a>
    </div>
    <p style="color:#64748b;font-size:12px;">Or copy: ${verifyLink}</p>
    <p style="color:#475569;font-size:12px;text-align:center;margin-top:24px;">© ${new Date().getFullYear()} Connect Freelance · connectfreelance.in</p>
  </div>
</div>`,
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
        html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#0F172A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:28px 40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Connect Freelance</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Action Required — Verification Pending</p>
  </div>
  <div style="padding:40px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Hello,</p>
    <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 20px;font-weight:700;">${name}</h2>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Your <strong style="color:#e2e8f0;">${roleLabel} account</strong> verification is still
      <strong style="color:#f59e0b;">incomplete</strong> on Connect Freelance.
    </p>
    <p style="color:#94a3b8;font-size:15px;line-height:1.7;margin:0 0 28px;">
      Complete your identity verification to unlock all platform features and build trust with ${roleLabel === 'client' ? 'freelancers' : 'clients'}.
    </p>
    <div style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.2);border-radius:12px;padding:20px 24px;margin-bottom:28px;">
      <p style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Why verify?</p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 6px;">✅ Unlock full platform access</p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 6px;">✅ Build trust with ${roleLabel === 'client' ? 'freelancers' : 'clients'}</p>
      <p style="color:#94a3b8;font-size:13px;margin:0;">✅ Secure your account identity</p>
    </div>
    <div style="text-align:center;">
      <a href="${verificationUrl}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-weight:700;font-size:15px;">Complete Verification →</a>
    </div>
  </div>
  <div style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
    <p style="color:#475569;font-size:12px;margin:0;">Automated reminder · If already verified, ignore this email.</p>
    <p style="color:#334155;font-size:11px;margin:8px 0 0;">© ${new Date().getFullYear()} Connect Freelance · connectfreelance.in</p>
  </div>
</div>`,
    });
};
