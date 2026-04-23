const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

const STRIKE_THRESHOLDS = {
    SOFT: 1,
    STRONG: 2,
    RESTRICT: 3,
    BAN: 5
};

/**
 * Orchestrates the strike logic and user enforcement
 */
exports.processViolation = async (userId, moderationResult, conversationId = null) => {
    try {
        const { severity, reason, message, detected_by, type } = moderationResult;

        // 1. Fetch current violations count
        const { data: profile, error: profileErr } = await adminClient
            .from('profiles')
            .select('warning_count, is_banned, is_restricted')
            .eq('user_id', userId)
            .single();

        if (profileErr) throw profileErr;

        // 2. Check for recent spam (Cooldown System)
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { count: recentViolations } = await adminClient
            .from('violations')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gt('created_at', fiveMinsAgo);

        if (recentViolations >= 3) {
            await adminClient.from('profiles').update({ 
                is_restricted: true,
                ban_reason: 'Automated restriction due to repeated policy violations.'
            }).eq('user_id', userId);
            
            return { action: 'RESTRICTED', reason: 'Repeated violations in a short period' };
        }

        // 3. Calculate strike increase
        // Split attacks and High severity get 2 strikes, others get 1.
        let strikeIncr = (severity === 'HIGH') ? 2 : 1;
        const newCount = (profile.warning_count || 0) + strikeIncr;

        // 4. Log violation
        const { data: violation } = await adminClient.from('violations').insert([{
            user_id: userId,
            message: message || 'Policy violation detected',
            type: type || 'contact_sharing',
            severity,
            confidence: moderationResult.confidence || 0.9,
            detected_by
        }]).select().single();

        // 5. Database Cleanup (Bypass Prevention)
        // If high severity or split attack, delete last 5 messages in conversation
        if (conversationId && severity === 'HIGH') {
            const { error: deletionError } = await adminClient
                .from('messages')
                .delete()
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(5);
            
            if (!deletionError) {
                logger.info(`[Enforcement] Cleaned up 5 messages in conversation ${conversationId} for user ${userId}`);
            }
        }

        // 6. Determine enforcement action
        let action = 'WARNING';
        let updates = { 
            warning_count: newCount,
            trust_score: Math.max(0, (profile.trust_score || 95) - (strikeIncr * 5))
        };

        if (newCount >= STRIKE_THRESHOLDS.BAN) {
            updates.is_banned = true;
            updates.ban_reason = `Permanent ban due to multiple violations: ${reason}`;
            action = 'BANNED';
        } else if (newCount >= STRIKE_THRESHOLDS.RESTRICT) {
            updates.is_restricted = true;
            updates.ban_reason = `Temporary restriction due to policy violations: ${reason}`;
            action = 'RESTRICTED';
        } else if (newCount >= STRIKE_THRESHOLDS.STRONG) {
            action = 'STRONG_WARNING';
        } else {
            action = 'SOFT_WARNING';
        }

        // 7. Update Profile
        await adminClient.from('profiles').update(updates).eq('user_id', userId);

        // 8. Log to system audit
        logger.info(`[Enforcement] Action taken on ${userId}: ${action}`, { strikes: newCount });

        return { action, strikes: newCount, reason, message };
    } catch (err) {
        logger.error('[Enforcement] Failed to process violation', err);
        return { action: 'NONE', error: err.message };
    }
};
