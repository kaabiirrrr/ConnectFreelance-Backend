const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

/**
 * Skills Management
 */
exports.addSkill = async (req, res, next) => {
    try {
        const { name, category } = req.body;
        const { data, error } = await supabase
            .from('skills')
            .insert({ name, category })
            .select()
            .single();

        if (error) throw error;
        await logAction(req.user.id, 'SKILL_ADD', data.id.toString(), `Added skill: ${name}`);
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

exports.deleteSkill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('skills').delete().eq('id', id);
        if (error) throw error;
        await logAction(req.user.id, 'SKILL_DELETE', id, `Deleted skill ID: ${id}`);
        res.status(200).json({ success: true, message: 'Skill deleted' });
    } catch (error) {
        next(error);
    }
};

/**
 * Announcements Management
 */
exports.createAnnouncement = async (req, res, next) => {
    try {
        const { title, message, target_role } = req.body;
        const { data, error } = await supabase
            .from('announcements')
            .insert({ title, message, target_role, created_by: req.user.id })
            .select()
            .single();

        if (error) throw error;
        await logAction(req.user.id, 'ANNOUNCEMENT_CREATE', data.id, `Created announcement: ${title}`);
        res.status(201).json({ success: true, data });
    } catch (error) {
        logger.error('Error in createAnnouncement', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to create announcement' });
    }
};

exports.getAnnouncements = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// Fraud Monitoring — Real Intelligence Engine
// ==========================================

exports.getSuspiciousUsers = async (req, res, next) => {
    try {
        // 1. All users with profiles
        const { data: users, error: userError } = await supabase
            .from('users')
            .select(`
                id, email, created_at,
                profiles (
                    name, avatar_url, is_flagged, is_banned,
                    is_restricted, fraud_flag, warning_count,
                    account_health_score, reliability_score,
                    otp_attempts, location, country
                )
            `);
        if (userError) throw userError;

        // 2. Bypass attempts
        const { data: bypassData } = await supabase
            .from('bypass_attempts')
            .select('user_id, strike_count, created_at')
            .order('created_at', { ascending: false });

        // 3. Cancelled contracts
        const { data: cancelledContracts } = await supabase
            .from('contracts')
            .select('freelancer_id, client_id, status, created_at')
            .eq('status', 'CANCELLED');

        // 4. User reports
        const { data: reportData } = await supabase
            .from('user_reports')
            .select('reported_id, reporter_id, reason, created_at');

        // 5. Violations
        const { data: violationData } = await supabase
            .from('violations')
            .select('user_id, reason, severity, created_at')
            .eq('status', 'ACTIVE');

        // 6. Proposals (velocity check)
        const { data: proposalData } = await supabase
            .from('proposals')
            .select('freelancer_id, created_at');

        // 7. Recent activity (last activity timestamp)
        const { data: activityData } = await supabase
            .from('user_activity_logs')
            .select('user_id, action_type, created_at')
            .order('created_at', { ascending: false })
            .limit(5000);

        // --- Build helper maps ---
        const bypassMap = {};
        (bypassData || []).forEach(b => {
            if (!bypassMap[b.user_id]) bypassMap[b.user_id] = { count: 0, latest: b.created_at };
            bypassMap[b.user_id].count += (b.strike_count || 1);
            if (new Date(b.created_at) > new Date(bypassMap[b.user_id].latest)) {
                bypassMap[b.user_id].latest = b.created_at;
            }
        });

        const cancelMap = {};
        (cancelledContracts || []).forEach(c => {
            [c.freelancer_id, c.client_id].filter(Boolean).forEach(uid => {
                cancelMap[uid] = (cancelMap[uid] || 0) + 1;
            });
        });

        const reportMap = {};
        (reportData || []).forEach(r => {
            if (!reportMap[r.reported_id]) reportMap[r.reported_id] = [];
            reportMap[r.reported_id].push(r);
        });

        const violationMap = {};
        (violationData || []).forEach(v => {
            if (!violationMap[v.user_id]) violationMap[v.user_id] = [];
            violationMap[v.user_id].push(v);
        });

        const proposalMap = {};
        (proposalData || []).forEach(p => {
            proposalMap[p.freelancer_id] = (proposalMap[p.freelancer_id] || 0) + 1;
        });

        const activityMap = {};
        (activityData || []).forEach(a => {
            if (!activityMap[a.user_id]) activityMap[a.user_id] = a.created_at;
        });

        // --- Score each user ---
        const scoredUsers = users.map(user => {
            const profile = user.profiles || {};
            let score = 0;
            const flags = [];

            if (profile.fraud_flag || profile.is_flagged) { score += 30; flags.push('Fraud flag'); }
            if (profile.is_banned) { score += 40; flags.push('Account banned'); }
            if (profile.is_restricted) { score += 15; flags.push('Account restricted'); }

            const warnings = profile.warning_count || 0;
            if (warnings > 0) { score += Math.min(warnings * 8, 24); flags.push(`${warnings} warning${warnings > 1 ? 's' : ''}`); }

            const health = profile.account_health_score ?? 100;
            if (health < 50) { score += 20; flags.push('Low account health'); }
            else if (health < 75) { score += 10; }

            const reliability = profile.reliability_score ?? 100;
            if (reliability < 60) { score += 15; flags.push('Low reliability score'); }

            const bypass = bypassMap[user.id];
            if (bypass) { score += Math.min(bypass.count * 10, 25); flags.push(`${bypass.count} bypass attempt${bypass.count > 1 ? 's' : ''}`); }

            const cancels = cancelMap[user.id] || 0;
            if (cancels >= 3) { score += Math.min(cancels * 5, 20); flags.push('Frequent cancellations'); }

            const reports = (reportMap[user.id] || []).length;
            if (reports > 0) { score += Math.min(reports * 8, 20); flags.push(`Reported ${reports} time${reports > 1 ? 's' : ''}`); }

            const violations = (violationMap[user.id] || []).length;
            if (violations > 0) { score += Math.min(violations * 12, 24); flags.push(`${violations} active violation${violations > 1 ? 's' : ''}`); }

            const proposals = proposalMap[user.id] || 0;
            if (proposals > 20) { score += 10; flags.push('High proposal velocity'); }

            const otpAttempts = profile.otp_attempts || 0;
            if (otpAttempts > 5) { score += 10; flags.push('OTP abuse detected'); }

            score = Math.min(score, 100);
            let riskLevel = 'LOW';
            if (score >= 70) riskLevel = 'HIGH';
            else if (score >= 35) riskLevel = 'MEDIUM';

            const lastActivity = activityMap[user.id] || user.created_at;

            return {
                id: user.id, email: user.email, created_at: user.created_at,
                name: profile.name || 'Anonymous User',
                avatar_url: profile.avatar_url || null,
                riskScore: score, riskLevel, flags,
                is_banned: profile.is_banned || false,
                is_restricted: profile.is_restricted || false,
                is_flagged: profile.is_flagged || false,
                fraud_flag: profile.fraud_flag || false,
                warning_count: warnings,
                account_health_score: health,
                reliability_score: reliability,
                bypassAttempts: bypass?.count || 0,
                cancelledContracts: cancels,
                reportCount: reports,
                violationCount: violations,
                lastActivity,
                location: profile.location || profile.country || 'Unknown',
            };
        });

        const suspicious = scoredUsers
            .filter(u => u.riskScore > 0 || u.is_flagged || u.is_banned || u.fraud_flag)
            .sort((a, b) => b.riskScore - a.riskScore);

        const totalFlagged = suspicious.length;
        const highRisk = suspicious.filter(u => u.riskLevel === 'HIGH').length;
        const mediumRisk = suspicious.filter(u => u.riskLevel === 'MEDIUM').length;
        const fraudAttempts24h = (bypassData || []).filter(b => {
            return (Date.now() - new Date(b.created_at).getTime()) < 24 * 60 * 60 * 1000;
        }).length;

        res.status(200).json({
            success: true,
            data: suspicious,
            summary: { totalFlagged, highRisk, mediumRisk, linkedClusters: 0, fraudAttempts24h },
        });
    } catch (error) {
        logger.error('Fraud detection error:', error);
        next(error);
    }
};

/**
 * Activity timeline for a specific user
 */
exports.getUserFraudTimeline = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const events = [];

        const { data: activities } = await supabase
            .from('user_activity_logs')
            .select('action_type, page_path, feature_name, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(15);

        (activities || []).forEach(a => events.push({
            type: 'activity', action: a.action_type,
            detail: a.feature_name || a.page_path || a.action_type,
            timestamp: a.created_at, severity: 'low',
        }));

        const { data: bypasses } = await supabase
            .from('bypass_attempts')
            .select('reason, message_preview, strike_count, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        (bypasses || []).forEach(b => events.push({
            type: 'bypass', action: 'Chat bypass attempt',
            detail: b.reason + (b.message_preview ? `: "${b.message_preview}"` : ''),
            timestamp: b.created_at, severity: 'high',
        }));

        const { data: violations } = await supabase
            .from('violations')
            .select('reason, severity, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        (violations || []).forEach(v => events.push({
            type: 'violation', action: 'Policy violation',
            detail: v.reason, timestamp: v.created_at, severity: v.severity,
        }));

        const { data: contracts } = await supabase
            .from('contracts')
            .select('status, title, created_at')
            .or(`freelancer_id.eq.${userId},client_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .limit(8);

        (contracts || []).forEach(c => events.push({
            type: 'contract', action: `Contract ${c.status.toLowerCase()}`,
            detail: c.title || 'Untitled contract', timestamp: c.created_at,
            severity: c.status === 'CANCELLED' ? 'medium' : 'low',
        }));

        const { data: reports } = await supabase
            .from('user_reports')
            .select('reason, created_at')
            .eq('reported_id', userId)
            .order('created_at', { ascending: false });

        (reports || []).forEach(r => events.push({
            type: 'report', action: 'User reported by peer',
            detail: r.reason, timestamp: r.created_at, severity: 'high',
        }));

        events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.status(200).json({ success: true, data: events.slice(0, 30) });
    } catch (error) {
        next(error);
    }
};

/**
 * Mark user as fraud
 */
exports.markUserAsFraud = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { error } = await supabase
            .from('profiles')
            .update({ fraud_flag: true, is_flagged: true })
            .eq('user_id', userId);
        if (error) throw error;
        await logAction(req.user.id, 'FRAUD_FLAG', userId, `Marked user ${userId} as fraud`);
        res.status(200).json({ success: true, message: 'User marked as fraud' });
    } catch (error) { next(error); }
};

/**
 * Freeze account (restrict)
 */
exports.freezeUserAccount = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { error } = await supabase
            .from('profiles')
            .update({ is_restricted: true })
            .eq('user_id', userId);
        if (error) throw error;
        await logAction(req.user.id, 'ACCOUNT_FREEZE', userId, `Froze account ${userId}`);
        res.status(200).json({ success: true, message: 'Account frozen successfully' });
    } catch (error) { next(error); }
};

/**
 * Clear fraud / mark as safe
 */
exports.clearFraudFlag = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { error } = await supabase
            .from('profiles')
            .update({ fraud_flag: false, is_flagged: false, is_restricted: false })
            .eq('user_id', userId);
        if (error) throw error;
        await logAction(req.user.id, 'FRAUD_CLEAR', userId, `Cleared fraud flag for user ${userId}`);
        res.status(200).json({ success: true, message: 'User marked as safe' });
    } catch (error) { next(error); }
};
