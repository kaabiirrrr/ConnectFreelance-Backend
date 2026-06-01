const nodemailer = require('nodemailer');

/**
 * Creates a transporter for sending emails.
 * Uses EMAIL_USER / EMAIL_PASS (Gmail SMTP) from .env.
 * Falls back to Ethereal test account in development if not configured.
 */
const getTransporter = async () => {
    // Support both naming conventions: EMAIL_USER/EMAIL_PASS and SMTP_USER/SMTP_PASS
    const smtpUser = process.env.EMAIL_USER || process.env.SMTP_USER;
    const smtpPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
    const smtpHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10);
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

    if (smtpUser && smtpPass) {
        return nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        });
    }

    // Fallback: Create test account for development
    console.warn('\n[MAILER] No SMTP credentials found in .env. Creating transient test account via Ethereal...');
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });
};

/**
 * Sends a branded teammate invitation email.
 * Only called after verifying the recipient is a registered user.
 * @param {object} opts
 * @param {string} opts.to           - Recipient email (verified registered user)
 * @param {string} opts.inviterName  - Display name of the inviting client
 * @param {string} opts.teamName     - Name of the team
 * @param {string} opts.role         - Assigned role (MANAGER | RECRUITER | MESSENGER | MEMBER)
 * @param {string[]} opts.permissions - List of permission strings for the role
 * @param {string} opts.recipientName - Display name of the recipient (from their profile)
 */
exports.sendInviteEmail = async ({ to, inviterName, teamName, role, permissions, recipientName }) => {
    const smtpUser = process.env.EMAIL_USER || process.env.SMTP_USER;
    const fromAddress = process.env.EMAIL_FROM || `"Connect Freelance" <${smtpUser || 'no-reply@connectfreelance.in'}>`;
    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://connectfreelance.in';
    const loginUrl = `${clientUrl}/login`;

    const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,';

    const roleColors = {
        MANAGER: '#4dc7ff',
        RECRUITER: '#a78bfa',
        MESSENGER: '#34d399',
        MEMBER: '#94a3b8',
    };
    const roleColor = roleColors[role?.toUpperCase()] || '#4dc7ff';

    try {
        const transporter = await getTransporter();
        const info = await transporter.sendMail({
            from: fromAddress,
            to,
            subject: `${inviterName} invited you to join ${teamName} on Connect Freelance`,
            html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
            <img src="https://connectfreelance.in/Logo2.png" alt="Connect Freelance" style="height:36px;margin-bottom:18px;display:block;margin-left:auto;margin-right:auto;" />
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">You've been invited to a team</h1>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:15px;color:rgba(255,255,255,0.55);">${greeting}</p>
            <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:rgba(255,255,255,0.85);">
              <strong style="color:#ffffff;">${inviterName}</strong> has invited you to join
              <strong style="color:#ffffff;">${teamName}</strong> on Connect Freelance.
              You've been assigned the role of
              <strong style="color:${roleColor};">${role}</strong>.
            </p>

            <!-- ROLE BADGE -->
            <div style="display:inline-block;background:rgba(77,199,255,0.08);border:1px solid rgba(77,199,255,0.2);border-radius:100px;padding:6px 18px;margin-bottom:28px;">
              <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${roleColor};">${role}</span>
            </div>

            <!-- PERMISSIONS BOX -->
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px 28px;margin-bottom:32px;">
              <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:${roleColor};">Your permissions</p>
              <table cellpadding="0" cellspacing="0" width="100%">
                ${permissions.map(p => `
                <tr>
                  <td style="padding:5px 0;vertical-align:top;width:20px;">
                    <span style="color:${roleColor};font-size:14px;">✓</span>
                  </td>
                  <td style="padding:5px 0 5px 8px;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.5;">${p}</td>
                </tr>`).join('')}
              </table>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-top:36px;">
              <a href="${loginUrl}"
                 style="display:inline-block;background:#4dc7ff;color:#0a0a0a;text-decoration:none;padding:15px 40px;border-radius:100px;font-weight:700;font-size:15px;letter-spacing:-0.01em;">
                Log in to accept invite
              </a>
              <p style="margin:16px 0 0;font-size:12px;color:rgba(255,255,255,0.25);">
                Log in with your registered account to access your team dashboard.
              </p>
            </div>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.07);">
            <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25);line-height:1.6;">
              &copy; 2026 Connect Freelancing Platform. All rights reserved.<br/>
              This invitation was sent to <strong>${to}</strong> because you have a registered account.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
            `,
        });

        const isTestMode = !(process.env.EMAIL_USER || process.env.SMTP_USER);
        if (isTestMode) {
            console.log('\n---------------------------------------------------------');
            console.log('[MAILER] Invitation Sent (ETHEREAL TEST MODE)');
            console.log(`To: ${to}`);
            console.log(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
            console.log('---------------------------------------------------------\n');
        } else {
            console.log(`[MAILER] Invite email sent to ${to}`);
        }

        return info;
    } catch (error) {
        console.error('[MAILER] Error sending invite email:', error);
        throw error;
    }
};
