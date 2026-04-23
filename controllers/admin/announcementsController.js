const supabase = require('../../supabase/client');
const adminClient = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

// ─── PUBLIC ─────────────────────────────────────────────────────────────────

// GET /api/announcements/active - return first active, non-expired announcement
exports.getActiveAnnouncement = async (req, res) => {
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from('announcements')
            .select('*')
            .eq('is_active', true)
            .lte('start_time', now)
            .gt('end_time', now)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[Announcements] getActive error', err);
        res.status(500).json({ success: false, message: 'Failed to fetch announcement' });
    }
};

// POST /api/announcements/log - track user engagement
exports.logAction = async (req, res) => {
    try {
        const { announcement_id, action } = req.body;
        const user_id = req.user?.id || null;

        if (!announcement_id || !['view', 'click', 'dismiss'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid payload' });
        }

        const { error } = await supabase
            .from('announcement_logs')
            .insert([{ announcement_id, user_id, action }]);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        logger.error('[Announcements] logAction error', err);
        res.status(500).json({ success: false, message: 'Failed to log action' });
    }
};

// ─── ADMIN ───────────────────────────────────────────────────────────────────

// GET /api/admin/announcements - all announcements
exports.getAllAnnouncements = async (req, res) => {
    try {
        const { data, error } = await adminClient
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[Announcements] getAll error', err);
        res.status(500).json({ success: false, message: 'Failed to fetch announcements' });
    }
};

// GET /api/admin/announcements/analytics - engagement stats
exports.getAnalytics = async (req, res) => {
    try {
        const { data: logs, error } = await adminClient
            .from('announcement_logs')
            .select('announcement_id, action');

        if (error) throw error;

        // Group by announcement
        const stats = {};
        logs.forEach(({ announcement_id, action }) => {
            if (!stats[announcement_id]) stats[announcement_id] = { views: 0, clicks: 0, dismisses: 0 };
            if (action === 'view') stats[announcement_id].views++;
            if (action === 'click') stats[announcement_id].clicks++;
            if (action === 'dismiss') stats[announcement_id].dismisses++;
        });

        // Compute engagement rate = clicks / views
        Object.keys(stats).forEach(id => {
            const s = stats[id];
            s.engagement_rate = s.views > 0 ? ((s.clicks / s.views) * 100).toFixed(1) : '0.0';
        });

        res.json({ success: true, data: stats });
    } catch (err) {
        logger.error('[Announcements] analytics error', err);
        res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
    }
};

// POST /api/admin/announcements/create
exports.createAnnouncement = async (req, res) => {
    try {
        const { title, message, type, start_time, end_time, is_active, offer_name, is_limited } = req.body;
        if (!title || !message || !end_time) {
            return res.status(400).json({ success: false, message: 'title, message, and end_time are required.' });
        }

        const { data, error } = await adminClient
            .from('announcements')
            .insert([{
                title,
                message,
                type: type || 'offer', // Default to offer
                start_time: start_time || new Date().toISOString(),
                end_time,
                is_active: is_active !== undefined ? Boolean(is_active) : true,
                created_by: req.user?.id || null,
                offer_name,
                is_limited: Boolean(is_limited)
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        logger.error('[Announcements] create error', err);
        res.status(500).json({ success: false, message: 'Failed to create offer' });
    }
};

// PATCH /api/admin/announcements/:id
exports.updateAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, message, type, start_time, end_time, is_active, offer_name, is_limited } = req.body;

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (message !== undefined) updates.message = message;
        if (type !== undefined) updates.type = type;
        if (start_time !== undefined) updates.start_time = start_time;
        if (end_time !== undefined) updates.end_time = end_time;
        if (is_active !== undefined) updates.is_active = Boolean(is_active);
        if (offer_name !== undefined) updates.offer_name = offer_name;
        if (is_limited !== undefined) updates.is_limited = Boolean(is_limited);

        const { data, error } = await adminClient
            .from('announcements')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[Announcements] update error', err);
        res.status(500).json({ success: false, message: 'Failed to update offer' });
    }
};

// DELETE /api/admin/announcements/:id
exports.deleteAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await adminClient.from('announcements').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        logger.error('[Announcements] delete error', err);
        res.status(500).json({ success: false, message: 'Failed to delete offer' });
    }
};
