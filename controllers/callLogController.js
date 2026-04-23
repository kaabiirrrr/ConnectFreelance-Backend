const adminClient = require('../supabase/adminClient');

// GET /api/calls — get call history for the logged-in user
exports.getCallLogs = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const { data: logs, error } = await adminClient
            .from('call_logs')
            .select('*')
            .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        if (!logs || logs.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Enrich with profiles
        const userIds = [...new Set(logs.flatMap(l => [l.caller_id, l.receiver_id]))];
        const { data: profiles } = await adminClient
            .from('profiles')
            .select('user_id, name, avatar_url')
            .in('user_id', userIds);

        const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        const enriched = logs.map(log => ({
            ...log,
            caller: profileMap[log.caller_id] || null,
            receiver: profileMap[log.receiver_id] || null,
            direction: log.caller_id === userId ? 'outgoing' : 'incoming',
            // Format duration as mm:ss
            duration_formatted: log.duration
                ? `${Math.floor(log.duration / 60)}:${String(log.duration % 60).padStart(2, '0')}`
                : '0:00'
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        next(err);
    }
};

// GET /api/calls/:conversationId — call logs for a specific conversation
exports.getConversationCallLogs = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { conversationId } = req.params;

        const { data: logs, error } = await adminClient
            .from('call_logs')
            .select('*')
            .eq('conversation_id', conversationId)
            .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const userIds = [...new Set((logs || []).flatMap(l => [l.caller_id, l.receiver_id]))];
        const { data: profiles } = userIds.length
            ? await adminClient.from('profiles').select('user_id, name, avatar_url').in('user_id', userIds)
            : { data: [] };

        const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        const enriched = (logs || []).map(log => ({
            ...log,
            caller: profileMap[log.caller_id] || null,
            receiver: profileMap[log.receiver_id] || null,
            direction: log.caller_id === userId ? 'outgoing' : 'incoming',
            duration_formatted: log.duration
                ? `${Math.floor(log.duration / 60)}:${String(log.duration % 60).padStart(2, '0')}`
                : '0:00'
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        next(err);
    }
};
