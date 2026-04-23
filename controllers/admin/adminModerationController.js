const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const adminUserController = require('./adminUserController');

exports.getAllReports = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('reports')
            .select(`
                *,
                reporter:users!reporter_id(email, profiles(name)),
                reported:users!reported_user_id(email, profiles(name))
            `, { count: 'exact' });

        if (status) query = query.eq('status', status.toUpperCase());

        const { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.resolveReport = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, admin_notes } = req.body; // ACTION_TAKEN, DISMISSED, INVESTIGATING

        // 1. Fetch report details to know what we are acting on
        const { data: report, error: fetchError } = await supabase
            .from('reports')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !report) {
            return res.status(404).json({ success: false, message: 'Report not found' });
        }

        // 2. If action is taken, perform the side effects
        if (status === 'ACTION_TAKEN') {
            const { item_type, item_id, reported_user_id } = report;

            if (item_type === 'PROFILE' && reported_user_id) {
                // Ban the user
                await adminUserController.banUser(reported_user_id, true, req.user.id);
            } else if (item_type === 'JOB' && item_id) {
                // Delete the job
                await supabase.from('jobs').delete().eq('id', item_id);
                await logAction(req.user.id, 'JOB_DELETE', item_id, `Moderator deleted job ${item_id} due to report ${id}`);
            } else if (item_type === 'PROPOSAL' && item_id) {
                // Delete the proposal
                await supabase.from('proposals').delete().eq('id', item_id);
                await logAction(req.user.id, 'PROPOSAL_DELETE', item_id, `Moderator deleted proposal ${item_id} due to report ${id}`);
            } else if (item_type === 'MESSAGE' && item_id) {
                // Delete the message
                await supabase.from('messages').delete().eq('id', item_id);
                await logAction(req.user.id, 'MESSAGE_DELETE', item_id, `Moderator deleted message ${item_id} due to report ${id}`);
            }
        }

        // 3. Update the report status
        const { error: updateError } = await supabase
            .from('reports')
            .update({
                status,
                admin_notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) throw updateError;

        await logAction(req.user.id, 'MODERATION_RESOLVE', id, `Resolved moderation report ID: ${id}. Status: ${status}`);

        res.status(200).json({
            success: true,
            message: `Moderation report updated to ${status}${status === 'ACTION_TAKEN' ? ' and action was executed' : ''}`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET All AI-Detected Violations (v2) - Resilient Version
 */
exports.getViolations = async (req, res, next) => {
    try {
        const { limit = 50, offset = 0, severity } = req.query;

        // Try the joined query first (Fastest)
        let query = supabase
            .from('violations')
            .select(`
                *,
                user:profiles!user_id(name, avatar_url, warning_count, is_banned, is_restricted)
            `, { count: 'exact' });

        if (severity) query = query.eq('severity', severity.toUpperCase());

        let { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        // FALLBACK: If relationship is missing (PGRST200), do manual join
        if (error && error.code === 'PGRST200') {
            console.warn('[Moderation] Schema cache mismatch detected. Falling back to manual fetch.');
            
            // 1. Fetch raw violations
            let baseQuery = supabase.from('violations').select('*', { count: 'exact' });
            if (severity) baseQuery = baseQuery.eq('severity', severity.toUpperCase());
            
            const { data: violations, count: totalCount, error: vError } = await baseQuery
                .order('created_at', { ascending: false })
                .range(offset, parseInt(offset) + parseInt(limit) - 1);
            
            if (vError) throw vError;

            // 2. Collect unique user IDs
            const userIds = [...new Set(violations.map(v => v.user_id))].filter(Boolean);

            // 3. Fetch matching profiles
            const { data: profiles, error: pError } = await supabase
                .from('profiles')
                .select('user_id, name, avatar_url, warning_count, is_banned, is_restricted')
                .in('user_id', userIds);

            if (pError) throw pError;

            // 4. Merge results manually
            const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));
            data = violations.map(v => ({
                ...v,
                user: profileMap[v.user_id] || null
            }));
            count = totalCount;
            error = null;
        }

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: { total: count, limit: parseInt(limit), offset: parseInt(offset) }
        });
    } catch (error) {
        console.error('[Moderation] Final catch in getViolations:', error);
        next(error);
    }
};


/**
 * GET Repeat Offenders (v2)
 */
exports.getRepeatOffenders = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, name, avatar_url, warning_count, is_banned, is_restricted')
            .gt('warning_count', 0)
            .order('warning_count', { ascending: false })
            .limit(20);

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

/**
 * MANUALLY Enforce Action (v2)
 */
exports.enforceAction = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { action, reason } = req.body; // WARN, RESTRICT, BAN, UNBAN, CLEAR_STRIKES

        let updates = {};
        if (action === 'BAN') {
            updates = { is_banned: true, is_restricted: true, ban_reason: reason || 'Banned by Administrator' };
        } else if (action === 'UNBAN') {
            updates = { is_banned: false, is_restricted: false, ban_reason: null, warning_count: 0 };
        } else if (action === 'RESTRICT') {
            updates = { is_restricted: true, ban_reason: reason || 'Restricted by Administrator' };
        } else if (action === 'CLEAR_STRIKES') {
            updates = { warning_count: 0, is_restricted: false };
        }

        const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('user_id', userId);

        if (error) throw error;

        await logAction(req.user.id, `ENFORCEMENT_${action}`, userId, `Manual action ${action} on user ${userId}. Reason: ${reason}`);

        res.status(200).json({ success: true, message: `Action ${action} executed successfully` });
    } catch (error) {
        next(error);
    }
};

