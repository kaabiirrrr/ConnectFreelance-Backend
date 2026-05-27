const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { protectAdmin } = require('../middleware/adminAuthMiddleware');
const { isUserOnline, getOnlineUsers, getIO } = require('../socket/index');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

// ─── USER PRESENCE ROUTES ─────────────────────────────────────────────────────

// GET /api/presence/online — get all currently online user IDs (user-auth)
router.get('/online', protect, (req, res) => {
    res.json({ success: true, data: { onlineUsers: getOnlineUsers() } });
});

// GET /api/presence/:userId — check if a specific user is online (user-auth)
router.get('/:userId', protect, (req, res) => {
    const { userId } = req.params;
    res.json({ success: true, data: { online: isUserOnline(userId) } });
});

// ─── ADMIN PRESENCE ROUTES ────────────────────────────────────────────────────

// GET /api/presence/admin/sessions — get all active sessions (admin-auth)
router.get('/admin/sessions', protectAdmin, async (req, res) => {
    try {
        const { data: sessions, error } = await adminClient
            .from('active_sessions')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Enrich with online status from in-memory socket map
        const enriched = sessions.map(s => ({
            ...s,
            is_online: isUserOnline(s.user_id)
        }));

        res.json({ success: true, data: enriched });
    } catch (err) {
        logger.error('[Presence] Failed to get sessions:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/presence/admin/user-presence — get all user presence records (admin-auth)
router.get('/admin/user-presence', protectAdmin, async (req, res) => {
    try {
        const { data, error } = await adminClient
            .from('user_presence')
            .select('*')
            .order('last_seen', { ascending: false })
            .limit(200);

        if (error) throw error;

        // Merge with in-memory socket data for real-time accuracy
        const enriched = data.map(p => ({
            ...p,
            is_socket_connected: isUserOnline(p.user_id)
        }));

        res.json({ success: true, data: enriched });
    } catch (err) {
        logger.error('[Presence] Failed to get user presence:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/presence/admin/admin-presence — get all admin presence records (admin-auth)
router.get('/admin/admin-presence', protectAdmin, async (req, res) => {
    try {
        const { data, error } = await adminClient
            .from('admin_presence')
            .select('*, admins(id, email, name, role, photo_url)')
            .order('last_active', { ascending: false });

        if (error) throw error;

        const enriched = data.map(p => ({
            ...p,
            is_socket_connected: isUserOnline(p.admin_id)
        }));

        res.json({ success: true, data: enriched });
    } catch (err) {
        logger.error('[Presence] Failed to get admin presence:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/presence/admin/online-counts — realtime counts (admin-auth)
router.get('/admin/online-counts', protectAdmin, async (req, res) => {
    try {
        const allOnline = getOnlineUsers();

        // Get their roles from profiles
        const { data: profiles } = await adminClient
            .from('profiles')
            .select('user_id, role')
            .in('user_id', allOnline);

        const { data: adminRows } = await adminClient
            .from('admins')
            .select('id')
            .in('id', allOnline);

        const adminIds = new Set((adminRows || []).map(a => a.id));
        const freelancers = (profiles || []).filter(p => p.role === 'FREELANCER').length;
        const clients = (profiles || []).filter(p => p.role === 'CLIENT').length;
        const admins = adminIds.size;

        res.json({
            success: true,
            data: {
                total: allOnline.length,
                freelancers,
                clients,
                admins
            }
        });
    } catch (err) {
        logger.error('[Presence] Failed to get online counts:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/presence/admin/revoke-session — force-terminate a session (admin-auth)
router.post('/admin/revoke-session', protectAdmin, async (req, res) => {
    try {
        const { socket_id, user_id, reason = 'force_revoke' } = req.body;

        if (!socket_id && !user_id) {
            return res.status(400).json({ success: false, message: 'socket_id or user_id required' });
        }

        const io = getIO();

        if (socket_id) {
            // Terminate specific socket
            const targetSocket = io.sockets.sockets.get(socket_id);
            if (targetSocket) {
                targetSocket.emit('session-revoked', { reason });
                targetSocket.disconnect(true);
            }

            // Update session history
            await adminClient.from('active_sessions').delete().eq('socket_id', socket_id);
            await adminClient.from('session_history')
                .update({ logout_at: new Date().toISOString(), termination_reason: reason })
                .eq('socket_id', socket_id)
                .catch(() => {}); // Don't throw if not found
        } else if (user_id) {
            // Terminate ALL sessions for a user
            const userSockets = io.sockets.sockets;
            userSockets.forEach((sock) => {
                if (sock.userId === user_id) {
                    sock.emit('session-revoked', { reason });
                    sock.disconnect(true);
                }
            });

            await adminClient.from('active_sessions').delete().eq('user_id', user_id);
            await adminClient.from('user_presence').update({
                status: 'offline',
                last_seen: new Date().toISOString()
            }).eq('user_id', user_id);
        }

        res.json({ success: true, message: 'Session(s) terminated successfully' });
    } catch (err) {
        logger.error('[Presence] Failed to revoke session:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/presence/admin/session-history/:userId — get session history for a user (admin-auth)
router.get('/admin/session-history/:userId', protectAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await adminClient
            .from('session_history')
            .select('*')
            .eq('user_id', userId)
            .order('login_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (err) {
        logger.error('[Presence] Failed to get session history:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
