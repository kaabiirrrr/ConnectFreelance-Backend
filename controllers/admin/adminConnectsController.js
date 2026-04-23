const connectsService = require('../../services/connectsService');
const adminClient = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

/**
 * Admin Connects Management Controller
 */
exports.getSettings = async (req, res, next) => {
    try {
        const settings = await connectsService.getSettings();
        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (err) {
        next(err);
    }
};

exports.updateSettings = async (req, res, next) => {
    try {
        const updates = req.body;
        const settingsId = updates.id;
        
        // Remove non-updatable/sensitive fields
        delete updates.id;
        delete updates.created_at;
        
        updates.updated_at = new Date().toISOString();

        let query = adminClient.from('connect_settings').update(updates);

        // Apply filter: If ID is provided, use it. Otherwise, target the first row 
        // as this is a singleton settings table.
        if (settingsId) {
            query = query.eq('id', settingsId);
        } else {
            // Fallback: Update the first row if ID is missing for some reason
            const { data: firstRow } = await adminClient.from('connect_settings').select('id').limit(1).single();
            if (firstRow) {
                query = query.eq('id', firstRow.id);
            } else {
                return res.status(404).json({ success: false, message: 'Settings row not found' });
            }
        }

        const { data, error } = await query.select().single();

        if (error) throw error;

        logger.info(`[AdminConnects] Settings updated by ${req.user.id}`, updates);

        res.status(200).json({
            success: true,
            message: 'Connect settings updated successfully',
            data
        });
    } catch (err) {
        next(err);
    }
};

exports.getEconomyAnalytics = async (req, res, next) => {
    try {
        // Fetch data points individually with their own error handling to prevent total failure
        const fetchIssued = adminClient.from('connect_transactions').select('amount').eq('type', 'CREDIT');
        const fetchUsed = adminClient.from('connect_transactions').select('amount').eq('type', 'DEBIT');
        
        // Dynamic RPC call with fallback
        let topUsersPromise;
        try {
            topUsersPromise = adminClient.rpc('get_top_connect_users');
        } catch (e) {
            topUsersPromise = Promise.resolve({ data: null });
        }

        const [issued, used, topUsers] = await Promise.all([
            fetchIssued,
            fetchUsed,
            topUsersPromise
        ]);

        // Fallback for top users if RPC failed or returned no data
        let topUsersData = [];
        if (!topUsers?.data || topUsers?.error) {
             const { data } = await adminClient
                .from('user_connects')
                .select('user_id, connects, profiles(name)')
                .order('connects', { ascending: false })
                .limit(5);
             topUsersData = data || [];
        } else {
            topUsersData = topUsers.data;
        }

        const totalIssuedValue = (issued.data || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const totalUsedValue = (used.data || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                total_issued: totalIssuedValue,
                total_used: totalUsedValue,
                top_users: topUsersData
            }
        });
    } catch (err) {
        logger.error('[AdminConnects] Analytics fetch failed', err);
        // Return a partial success with zero values instead of a 500
        res.status(200).json({
            success: true,
            data: {
                total_issued: 0,
                total_used: 0,
                top_users: []
            }
        });
    }
};

exports.getAuditLedger = async (req, res, next) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const { data, error, count } = await adminClient
            .from('connect_transactions')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (error) throw error;

        // Enrich with profile names separately to avoid join issues
        const userIds = [...new Set((data || []).map(t => t.user_id).filter(Boolean))];
        let profileMap = {};
        if (userIds.length) {
            const { data: profiles } = await adminClient
                .from('profiles')
                .select('user_id, name, email, avatar_url')
                .in('user_id', userIds);
            profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));
        }

        const enriched = (data || []).map(t => ({
            ...t,
            profile: profileMap[t.user_id] || null
        }));

        res.status(200).json({ success: true, data: enriched, total: count });
    } catch (err) {
        logger.error('[AdminConnects] Ledger fetch failed', err);
        next(err);
    }
};
