const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendActionOTPEmail } = require('../utils/emailService');

// Map to track resend limit (3 sends per 15-minute window)
// Key: userId, Value: { sendCount, createdAt }
const limiter = new Map();

// Auto-cleanup: TTL of 15 minutes, runs every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [id, entry] of limiter.entries()) {
        if (entry.createdAt < cutoff) {
            limiter.delete(id);
        }
    }
}, 5 * 60 * 1000);

function generateNumericOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /api/otp/send
 * Body: { action } (e.g. "job_post", "proposal_submit")
 */
exports.sendOTP = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { action } = req.body;

        if (!action || !['job_post', 'proposal_submit'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Valid action is required (job_post or proposal_submit).'
            });
        }

        // 1. Check rate limit in memory (Map) for resends
        const now = Date.now();
        let userLimit = limiter.get(userId);

        if (userLimit) {
            // If the 15-minute window has passed, reset
            if (now - userLimit.createdAt > 15 * 60 * 1000) {
                userLimit = { sendCount: 1, createdAt: now };
                limiter.set(userId, userLimit);
            } else {
                if (userLimit.sendCount >= 3) {
                    return res.status(429).json({
                        success: false,
                        message: 'Too many OTP requests. Please wait 15 minutes before trying again.'
                    });
                }
                userLimit.sendCount += 1;
            }
        } else {
            userLimit = { sendCount: 1, createdAt: now };
            limiter.set(userId, userLimit);
        }

        // 2. Fetch profile to get email & name
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('email, name')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileError || !profile) {
            return res.status(404).json({
                success: false,
                message: 'User profile not found.'
            });
        }

        if (!profile.email) {
            return res.status(400).json({
                success: false,
                message: 'No registered email found for this profile.'
            });
        }

        // 3. Generate OTP
        const otp = generateNumericOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

        // 4. Hash OTP with bcryptjs
        const salt = await bcrypt.genSalt(10);
        const hashedOtp = await bcrypt.hash(otp, salt);

        // 5. Update profiles in DB
        const { error: updateError } = await adminClient
            .from('profiles')
            .update({
                email_otp: hashedOtp,
                otp_expires_at: expiresAt,
                otp_purpose: action,
                otp_attempts: 0 // Reset attempts on fresh send
            })
            .eq('user_id', userId);

        if (updateError) {
            logger.error('[otpActionController] DB update failed:', updateError);
            throw updateError;
        }

        // 6. Send email
        await sendActionOTPEmail(profile.email, otp, action, profile.name);

        logger.info(`[otpActionController] OTP (${action}) sent to ${profile.email}`);

        res.status(200).json({
            success: true,
            message: 'OTP sent to your registered email address.'
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/otp/verify
 * Body: { otp, purpose }
 */
exports.verifyOTP = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { otp, purpose } = req.body;

        if (!otp) {
            return res.status(400).json({
                success: false,
                message: 'OTP code is required.'
            });
        }

        if (!purpose || !['job_post', 'proposal_submit'].includes(purpose)) {
            return res.status(400).json({
                success: false,
                message: 'Valid purpose is required.'
            });
        }

        // 1. Fetch stored OTP details
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('email_otp, otp_expires_at, otp_purpose, otp_attempts')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileError || !profile) {
            return res.status(404).json({
                success: false,
                message: 'User profile not found.'
            });
        }

        // 2. Security guard: too many attempts
        if (profile.otp_attempts >= 5) {
            return res.status(429).json({
                success: false,
                message: 'Too many incorrect attempts. Please request a new OTP.'
            });
        }

        // 3. Security guard: purpose mismatch
        if (profile.otp_purpose !== purpose) {
            return res.status(403).json({
                success: false,
                message: 'This OTP is not valid for this action.'
            });
        }

        // 4. Security guard: expiry
        if (!profile.otp_expires_at || new Date() > new Date(profile.otp_expires_at)) {
            return res.status(410).json({
                success: false,
                message: 'OTP has expired. Please request a new one.'
            });
        }

        // 5. Compare OTP
        const isMatch = await bcrypt.compare(String(otp), profile.email_otp || '');

        if (!isMatch) {
            const newAttempts = (profile.otp_attempts || 0) + 1;
            await adminClient
                .from('profiles')
                .update({ otp_attempts: newAttempts })
                .eq('user_id', userId);

            const remaining = 5 - newAttempts;
            if (remaining <= 0) {
                return res.status(429).json({
                    success: false,
                    message: 'Too many incorrect attempts. Please request a new OTP.'
                });
            }

            return res.status(401).json({
                success: false,
                message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            });
        }

        // 6. On success: wipe OTP fields
        await adminClient
            .from('profiles')
            .update({
                email_otp: null,
                otp_expires_at: null,
                otp_purpose: null,
                otp_attempts: 0
            })
            .eq('user_id', userId);

        logger.info(`[otpActionController] OTP verified for user ${userId} (purpose: ${purpose})`);

        res.status(200).json({
            success: true,
            message: 'OTP verified successfully.'
        });
    } catch (err) {
        next(err);
    }
};
