const supabase = require('../../supabase/adminClient');

exports.sendAnnouncement = async (req, res, next) => {
    try {
        const { title, content, type = 'SYSTEM', target_role } = req.body;

        if (!title || !content) {
            return res.status(400).json({ success: false, data: null, message: 'Title and content are required' });
        }

        // 1. Fetch targeted users from profiles
        let query = supabase.from('profiles').select('user_id');
        if (target_role && ['CLIENT', 'FREELANCER'].includes(target_role)) {
            query = query.eq('role', target_role);
        }

        const { data: users, error: fetchError } = await query;
        if (fetchError) throw fetchError;

        if (!users || users.length === 0) {
            return res.status(400).json({ success: false, data: null, message: 'No users found to send notification' });
        }

        // 2. Prepare bulk insert
        const notifications = users.map(u => ({
            user_id: u.user_id,
            title,
            content,
            type
        }));

        const { error: insertError } = await supabase
            .from('notifications')
            .insert(notifications);

        if (insertError) throw insertError;

        res.status(200).json({ success: true, message: `Announcement sent to ${users.length} users` });
    } catch (error) {
        next(error);
    }
};
