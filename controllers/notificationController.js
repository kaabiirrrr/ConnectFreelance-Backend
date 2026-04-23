const supabase = require('../supabase/client');
const { getIO } = require('../socket/index');
const logger = require('../utils/logger');

/**
 * Saves a notification to DB AND pushes it via socket to the target user instantly.
 * Safe to call without awaiting — won't throw on socket failure.
 */
exports.notifyUser = async (userId, { title, content, type = 'INFO', link = null }) => {
    try {
        const { data } = await supabase.from('notifications').insert([{
            user_id: userId, title, content, type, link, is_read: false
        }]).select('id, title, content, type, link, is_read, created_at').single();
        // Push real-time event to user's personal room
        try { getIO().to(`room:user:${userId}`).emit('new-notification', data); } catch (_) {}
        return data;
    } catch (err) {
        logger.error('notifyUser failed', err);
    }
};

exports.getNotifications = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data, error } = await supabase
            .from('notifications')
            .select('id, title, content, type, link, is_read, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Notifications retrieved' });
    } catch (error) {
        next(error);
    }
};

exports.markAsRead = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.body; // array of IDs or single ID or all

        let query = supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);

        if (id) {
            query = query.in('id', Array.isArray(id) ? id : [id]);
        } else {
            query = query.eq('is_read', false); // Mark all
        }

        const { data, error } = await query.select('id, is_read');

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Notifications marked as read' });
    } catch (error) {
        next(error);
    }
};

exports.deleteNotification = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const { error } = await supabase
            .from('notifications')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/notifications/announcements
 * Proxies announcement fetch to avoid browser connection issues to Supabase direct.
 */
exports.getAnnouncements = async (req, res, next) => {
    try {
        const userRole = req.user.role?.toUpperCase() || 'CLIENT';
        
        // Filter by ALL or specific role
        const { data, error } = await supabase
            .from('announcements')
            .select('id, title, content:message, type, target_role, created_at')
            .or(`target_role.eq.ALL,target_role.eq.${userRole}`)
            .order('created_at', { ascending: false });

        if (error) {
            logger.warn('Announcements table might be missing or query failed:', error.message);
            return res.status(200).json({ 
                success: true, 
                data: [], 
                message: 'No announcements available at this time.' 
            });
        }

        res.status(200).json({ 
            success: true, 
            data: data || [], 
            message: 'Announcements retrieved successfully' 
        });
    } catch (error) {
        logger.error('Error in getAnnouncements', error);
        next(error);
    }
};
