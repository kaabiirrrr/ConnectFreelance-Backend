const nodemailer = require('nodemailer');

/**
 * Creates a transporter for sending emails.
 * Uses environment variables if available, otherwise creates a test account via Ethereal.
 */
const getTransporter = async () => {
    // Check for real SMTP credentials in .env
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
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
 */
exports.sendInviteEmail = async ({ to, inviterName, teamName, role, permissions }) => {
    try {
        const transporter = await getTransporter();
        const info = await transporter.sendMail({
            from: `"Connect Team" <${process.env.SMTP_USER || 'no-reply@connect.com'}>`,
            to,
            subject: `${inviterName} invited you to join their team on Connect`,
            html: `
            <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                <div style="padding: 40px 20px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <img src="https://connect-freelancing.vercel.app/Logo2.png" alt="Connect" style="height: 40px; margin-bottom: 20px;" />
                    <h1 style="font-size: 24px; font-weight: bold; margin: 0; letter-spacing: -0.02em;">Digital Workspace Invitation</h1>
                </div>
                
                <div style="padding: 40px 30px;">
                    <p style="font-size: 16px; line-height: 1.6; color: rgba(255,255,255,0.7); margin-bottom: 30px;">
                        Hello,
                    </p>
                    <p style="font-size: 18px; line-height: 1.6; color: #ffffff; margin-bottom: 30px;">
                        <strong>${inviterName}</strong> has invited you to join the <strong>${teamName}</strong> team on Connect as a <strong>${role}</strong>.
                    </p>
                    
                    <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 25px; margin-bottom: 30px; border: 1px solid rgba(255,255,255,0.1);">
                        <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #4dc7ff; margin-top: 0; margin-bottom: 15px;">Your Permissions</h3>
                        <ul style="margin: 0; padding-left: 20px; color: rgba(255,255,255,0.8); font-size: 14px; line-height: 1.8;">
                            ${permissions.map(p => `<li>${p}</li>`).join('')}
                        </ul>
                    </div>

                    <div style="text-align: center; margin-top: 40px;">
                        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/signup?email=${to}" 
                           style="background: #4dc7ff; color: #0a0a0a; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 10px 20px rgba(77, 199, 255, 0.3);">
                            Join the Team
                        </a>
                    </div>
                </div>

                <div style="padding: 30px; text-align: center; font-size: 12px; color: rgba(255,255,255,0.4); border-top: 1px solid rgba(255,255,255,0.1);">
                    &copy; 2026 Connect Freelancing Platform. All rights reserved.<br/>
                    Professional workflow for digital teams.
                </div>
            </div>
            `,
        });

        if (!process.env.SMTP_USER) {
            console.log('\n---------------------------------------------------------');
            console.log('[MAILER] Invitation Sent (TRANSIT TEST MODE)');
            console.log(`Accepted: ${info.accepted}`);
            console.log(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
            console.log('---------------------------------------------------------\n');
        }

        return info;
    } catch (error) {
        console.error('[MAILER] Error sending email:', error);
        throw error;
    }
};
