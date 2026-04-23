const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * Get admin audit logs (paginated, filterable)
 * GET /api/admin/logs
 * Security: SUPER_ADMIN only
 */
exports.getAuditLogs = async (req, res, next) => {
    try {
        const { action, target_type, admin_id } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = (page - 1) * limit;

        let query = adminClient
            .from('admin_audit_logs')
            .select(`
                id, action, target_type, target_id, details, ip_address, created_at,
                admin:admin_id ( id, name, email, role )
            `, { count: 'exact' });

        if (action) query = query.eq('action', action);
        if (target_type) query = query.eq('target_type', target_type);
        if (admin_id) query = query.eq('admin_id', admin_id);

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const totalPages = Math.ceil((count || 0) / limit);

        res.status(200).json({
            success: true,
            data: data || [],
            pagination: { page, limit, total: count || 0, totalPages }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Log an admin action (helper function — called by other controllers)
 * @param {string} adminId - UUID of the admin
 * @param {string} action - Action performed (e.g., 'USER_BAN', 'JOB_DELETE')
 * @param {string} targetType - Type of target ('USER', 'JOB', 'CONTRACT', 'PAYMENT')
 * @param {string} targetId - UUID of the target
 * @param {object} details - Additional context (JSON)
 * @param {string} ipAddress - IP address of the admin
 */
exports.logAction = async (adminId, action, targetType, targetId, details = {}, ipAddress = null) => {
    try {
        await adminClient.from('admin_audit_logs').insert([{
            admin_id: adminId,
            action,
            target_type: targetType,
            target_id: targetId,
            details,
            ip_address: ipAddress
        }]);
    } catch (err) {
        // Never let audit logging break the main flow
        logger.error('[AuditLog] Failed to log action', err);
    }
};

/**
 * Get summary of admin actions (for dashboard)
 * GET /api/admin/logs/summary
 * Security: SUPER_ADMIN only
 */
exports.getLogsSummary = async (req, res, next) => {
    try {
        const { data: logs, error } = await adminClient
            .from('admin_audit_logs')
            .select('action, created_at')
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Group by action type
        const actionCounts = {};
        (logs || []).forEach(log => {
            actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        });

        res.status(200).json({
            success: true,
            data: {
                total_actions_30d: logs?.length || 0,
                by_action: actionCounts
            }
        });
    } catch (error) {
        next(error);
    }
};
