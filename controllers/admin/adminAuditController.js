const supabase = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

/**
 * Log an admin action to the database
 * @param {string} adminId - ID of the admin performing the action
 * @param {string} actionType - Type of action (e.g., 'VERIFY_USER', 'DELETE_JOB')
 * @param {string} targetId - ID of the entity being acted upon
 * @param {string} description - Human-readable description
 * @param {string} targetType - Optional type of target (e.g., 'USER', 'JOB')
 */
exports.logAction = async (adminId, actionType, targetId, description, targetType = null) => {
    try {
        // Fetch admin email for the log
        const { data: admin } = await supabase
            .from('admins')
            .select('email')
            .eq('id', adminId)
            .maybeSingle();

        await supabase.from('admin_logs').insert({
            admin_id: adminId,
            admin_email: admin?.email || 'System',
            action_type: actionType,
            target_id: targetId,
            target_type: targetType,
            description: description,
            created_at: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to log admin action', error);
    }
};

exports.getLogs = async (req, res, next) => {
    try {
        const { 
            action_type, 
            admin_email, 
            start_date, 
            end_date, 
            limit = 50, 
            offset = 0 
        } = req.query;

        // 1. Fetch logs with admin details
        let query = supabase
            .from('admin_logs')
            .select(`
                *,
                timestamp:created_at,
                admin:admins!admin_logs_admin_id_profiles_fkey(name, email, photo_url)
            `, { count: 'exact' });

        if (action_type) query = query.eq('action_type', action_type);
        if (admin_email) query = query.ilike('admin_email', `%${admin_email}%`);
        
        if (start_date && start_date.trim() !== '') {
            query = query.gte('created_at', start_date);
        }
        if (end_date && end_date.trim() !== '') {
            query = query.lte('created_at', end_date);
        }

        const safeOffset = isNaN(parseInt(offset)) ? 0 : parseInt(offset);
        const safeLimit = isNaN(parseInt(limit)) ? 50 : parseInt(limit);

        const { data: logs, count, error: logsError } = await query
            .order('created_at', { ascending: false })
            .range(safeOffset, safeOffset + safeLimit - 1);

        if (logsError) {
            logger.error('[AdminAudit] Logs fetch failed', logsError);
            throw logsError;
        }

        res.status(200).json({
            success: true,
            data: logs || [],
            pagination: { total: count || 0, limit: parseInt(limit), offset: parseInt(offset) }
        });
    } catch (error) {
        next(error);
    }
};
