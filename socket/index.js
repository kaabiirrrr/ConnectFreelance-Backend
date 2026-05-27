const { Server } = require('socket.io');
const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const moderationService = require('../services/moderationService');
const enforcementService = require('../services/enforcementService');
const notificationHelper = require('../utils/notificationHelper');

// Socket Rate Limiting (Strikes)
const strikeCounts = new Map(); // socketId -> { count, lastReset }
const STRIKE_LIMIT = 30; // 30 events per minute
const STRIKE_WINDOW = 60 * 1000;

function incrementStrikes(socketId) {
    const now = Date.now();
    let data = strikeCounts.get(socketId) || { count: 0, lastReset: now };

    if (now - data.lastReset > STRIKE_WINDOW) {
        data = { count: 1, lastReset: now };
    } else {
        data.count++;
    }
    strikeCounts.set(socketId, data);
    return data.count > STRIKE_LIMIT;
}

// userId → Set<socketId>  (multi-tab support)
const onlineUsers = new Map();

// userId → boolean (user preference to show online)
const userOnlinePreferences = new Map();

// userId → timestamp of last heartbeat
const heartbeats = new Map();

// How long without a heartbeat before a user is considered offline (ms)
const HEARTBEAT_TIMEOUT = 45000; // 45s
const HEARTBEAT_INTERVAL = 30000; // client should ping every 30s

let io;


// ─── Heartbeat checker — runs every 15s ─────────────────────────────────────
// Only marks offline users whose heartbeat has truly expired AND have no sockets
setInterval(() => {
    if (!io) return;
    const now = Date.now();
    let changed = false;

    for (const [userId, lastSeen] of heartbeats.entries()) {
        const sockets = onlineUsers.get(userId);
        const hasActiveSockets = sockets && sockets.size > 0;
        const heartbeatExpired = now - lastSeen > HEARTBEAT_TIMEOUT;

        if (!hasActiveSockets && heartbeatExpired) {
            heartbeats.delete(userId);
            onlineUsers.delete(userId);
            changed = true;
        }
    }

    if (changed) {
        // io.emit('online-users', [...onlineUsers.keys()]); // REMOVED: Privacy Hardening
        logger.log(`[Presence] Cleanup complete. Users in memory: ${onlineUsers.size}`);
    }
}, 15000);


function initSocketIO(httpServer) {
    const devOrigins = [
        'http://localhost:5173', 'http://127.0.0.1:5173',
        'http://localhost:5174', 'http://127.0.0.1:5174',
        'http://localhost:5175', 'http://127.0.0.1:5175',
        'http://localhost:3000'
    ];
    
    // Explicitly allow production domains
    const prodOrigins = [
        'https://connectfreelance.in',
        'https://www.connectfreelance.in',
        'https://coonnectt.vercel.app',
        process.env.CLIENT_URL
    ].filter(Boolean);

    const origins = [...devOrigins, ...prodOrigins];
    logger.log(`[Socket] Initializing with origins: ${origins.join(', ')}`);

    io = new Server(httpServer, {
        cors: {
            origin: origins,
            credentials: true,
            methods: ["GET", "POST"]
        },
        transports: ['websocket', 'polling'], // Allow fallback for better stability
        allowEIO3: true,                     // Support older clients if any
        pingTimeout: 60000,                  // 60s
        pingInterval: 25000,                 // 25s
        connectTimeout: 45000                // 45s
    });

    // Auth middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token
                || socket.handshake.headers?.authorization?.replace('Bearer ', '');
            
            if (!token) {
                logger.warn('[Socket] Connection rejected: No token provided', { socketId: socket.id });
                return next(new Error('Authentication required'));
            }

            logger.log(`[Socket] Auth starting for handshake: ${socket.id}`);
            
            // Timeout Supabase auth after 5 seconds to prevent hanging the handshake
            const authPromise = supabase.auth.getUser(token);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Supabase auth timeout')), 5000)
            );

            const { data: { user }, error } = await Promise.race([authPromise, timeoutPromise]);

            if (error || !user) {
                logger.error('[Socket] Auth failed: Invalid token', { error });
                return next(new Error('Invalid token'));
            }

            socket.userId = user.id;
            socket.userEmail = user.email;

            // ─── ENTERPRISE ENFORCEMENT: Ban/Suspension Check ─────────────
            const { data: profile } = await adminClient
                .from('profiles')
                .select('is_banned, is_restricted, online_for_messages')
                .eq('user_id', user.id)
                .single();

            socket.onlineForMessages = profile ? profile.online_for_messages !== false : true;

            if (profile?.is_banned) {
                logger.error(`[Socket] Auth failed: User ${user.id} is BANNED`);
                return next(new Error('Access denied: Your account is permanently banned.'));
            }
            if (profile?.is_restricted) {
                logger.warn(`[Socket] Auth warning: User ${user.id} is RESTRICTED`);
                // We'll allow connection but handle event-level blocks if needed
            }
            // ─────────────────────────────────────────────────────────────

            logger.log(`[Socket] Auth success for user: ${user.id}`);
            next();
        } catch (err) {
            logger.error('[Socket] Auth internal error:', err.message);
            next(new Error('Auth error: ' + err.message));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.userId;
        const userRole = socket.userRole || null;
        logger.log(`[Socket] User connected: ${userId}`);

        // ─── SQL PRESENCE RECORDING ───
        const ipAddress = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || 'IP Unknown';
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'desktop';
        if (/mobile|android|iphone|ipad|phone/i.test(userAgent)) deviceType = 'mobile';
        else if (/tablet|ipad|playbook|silk/i.test(userAgent)) deviceType = 'tablet';

        // 1. Insert session history record
        adminClient.from('session_history').insert([{
            user_id: userId,
            ip_address: ipAddress,
            user_agent: userAgent
        }]).select('id').single().then(({ data: histData }) => {
            if (histData) {
                socket.historyId = histData.id;
            }
        }).catch(err => logger.error('[Socket] Failed to insert session history:', err));

        // 2. Insert active session record
        adminClient.from('active_sessions').insert([{
            user_id: userId,
            socket_id: socket.id,
            ip_address: ipAddress,
            user_agent: userAgent,
            device_type: deviceType
        }]).catch(err => logger.error('[Socket] Failed to insert active session:', err));

        // 3. Upsert user presence state
        adminClient.from('user_presence').upsert({
            user_id: userId,
            status: 'online',
            last_seen: new Date().toISOString(),
            ip_address: ipAddress,
            device_info: { userAgent, deviceType }
        }).catch(err => logger.error('[Socket] Failed to upsert user presence:', err));

        // 4. Check if admin and upsert admin presence state
        adminClient.from('admins').select('role, name').eq('id', userId).maybeSingle().then(({ data: adminRow }) => {
            if (adminRow) {
                socket.isAdmin = true;
                socket.adminRole = adminRow.role;
                socket.adminName = adminRow.name;
                
                adminClient.from('admin_presence').upsert({
                    admin_id: userId,
                    status: 'online',
                    last_active: new Date().toISOString(),
                    current_module: 'Command Center'
                }).catch(err => logger.error('[Socket] Failed to upsert admin presence:', err));
            }
        }).catch(err => logger.error('[Socket] Failed to check admin row:', err));

        // Emit login presence event
        adminClient.from('presence_events').insert([{
            user_id: userId,
            event_type: 'login'
        }]).catch(err => logger.error('[Socket] Failed to log presence event:', err));

        // Track online status
        const isFirstSocket = !onlineUsers.has(userId) || onlineUsers.get(userId).size === 0;
        if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socket.id);
        
        // Store online presence preference
        const isOnlinePref = socket.onlineForMessages !== false;
        userOnlinePreferences.set(userId, isOnlinePref);

        if (isFirstSocket && isOnlinePref) {
            // Broadcast online status to conversation partners
            adminClient
                .from('conversations')
                .select('id')
                .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
                .then(({ data: conversations }) => {
                    if (conversations) {
                        for (const conv of conversations) {
                            io.to(`conv:${conv.id}`).emit('partner-presence', {
                                conversationId: conv.id,
                                userId,
                                isOnline: true
                            });
                        }
                    }
                })
                .catch(err => logger.error('[Socket] Connect presence broadcast error:', err));
        }

        // Toggle online event handler
        socket.on('toggle-online', async ({ online }) => {
            const isOnline = !!online;
            userOnlinePreferences.set(userId, isOnline);

            // Persist to DB
            try {
                await adminClient
                    .from('profiles')
                    .update({ online_for_messages: isOnline })
                    .eq('user_id', userId);
            } catch (err) {
                logger.error(`[Socket] Failed to persist online_for_messages for ${userId}:`, err);
            }

            // Broadcast presence status change to all partners
            try {
                const { data: conversations } = await adminClient
                    .from('conversations')
                    .select('id')
                    .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`);

                if (conversations) {
                    for (const conv of conversations) {
                        io.to(`conv:${conv.id}`).emit('partner-presence', {
                            conversationId: conv.id,
                            userId,
                            isOnline: isOnline
                        });
                    }
                }
            } catch (err) {
                logger.error('[Socket] toggle-online broadcast error:', err);
            }
        });

        // --- 🛡️ BANK-GRADE: PRIVACY HARDENING ---
        // io.emit('online-users', [...onlineUsers.keys()]); // REMOVED: Do not broadcast globally


        // ─── HEARTBEAT ────────────────────────────────────────────────────
        // Client pings every 30s to show they are still active
        socket.on('heartbeat', ({ currentPage } = {}) => {
            heartbeats.set(userId, Date.now());

            // Keep presence state as 'active' in DB and update current_page
            adminClient.from('user_presence').upsert({
                user_id: userId,
                status: 'active',
                last_active: new Date().toISOString(),
                last_seen: new Date().toISOString(),
                current_page: currentPage || null
            }).catch(err => logger.error('[Socket] Heartbeat presence update error:', err));

            // Update active session ping timestamp
            adminClient.from('active_sessions').update({
                last_ping_at: new Date().toISOString()
            }).eq('socket_id', socket.id).catch(err => logger.error('[Socket] Heartbeat session ping error:', err));

            // Acknowledge the heartbeat
            socket.emit('heartbeat-ack', { ts: Date.now() });
        });

        // ─── ACTIVITY PING ────────────────────────────────────────────────
        // Throttled activity ping from mouse/keyboard interactions on client
        socket.on('activity-ping', ({ currentPage } = {}) => {
            heartbeats.set(userId, Date.now());

            adminClient.from('user_presence').upsert({
                user_id: userId,
                status: 'active',
                last_active: new Date().toISOString(),
                current_page: currentPage || null
            }).catch(err => logger.error('[Socket] Activity ping update error:', err));
        });

        // ─── IDLE STATUS CHANGE ───────────────────────────────────────────
        // Emitted by Page Visibility API (tab blur) or inactivity timer
        socket.on('status-change', ({ status, currentPage } = {}) => {
            const allowedStatuses = ['active', 'idle', 'offline'];
            const safeStatus = allowedStatuses.includes(status) ? status : 'idle';

            adminClient.from('user_presence').upsert({
                user_id: userId,
                status: safeStatus,
                last_active: new Date().toISOString(),
                current_page: currentPage || null
            }).catch(err => logger.error('[Socket] Status change update error:', err));

            if (safeStatus === 'idle') {
                adminClient.from('presence_events').insert([{
                    user_id: userId,
                    event_type: 'idle_start'
                }]).catch(err => logger.error('[Socket] idle_start event log error:', err));
            } else if (safeStatus === 'active') {
                adminClient.from('presence_events').insert([{
                    user_id: userId,
                    event_type: 'idle_end'
                }]).catch(err => logger.error('[Socket] idle_end event log error:', err));
            }
        });

        // ─── ADMIN MODULE TRACKING ─────────────────────────────────────────
        // Emitted by admin UI when navigating between admin pages/modules
        socket.on('admin-module-update', ({ module } = {}) => {
            if (!socket.isAdmin) return;
            const allowedModules = ['Dashboard', 'Users', 'KYC', 'Disputes', 'Moderation', 'Treasury', 'Contracts', 'Jobs', 'Support', 'FAQ', 'Settings', 'Command Center', 'Fraud', 'Trust Graph', 'Verification', 'Admins'];
            const safeModule = module && allowedModules.includes(module) ? module : 'Dashboard';

            adminClient.from('admin_presence').upsert({
                admin_id: userId,
                status: 'online',
                last_active: new Date().toISOString(),
                current_module: safeModule
            }).catch(err => logger.error('[Socket] Admin module update error:', err));
        });

        // Middleware for event-level rate limiting (strikes)
        socket.use(([event, ...args], next) => {
            if (incrementStrikes(socket.id)) {
                logger.warn(`[Socket] Rate limit exceeded for socket ${socket.id} (User: ${userId}) on event: ${event}`);
                return; // Silently ignore or emit error
            }
            next();
        });

        // ─── MESSAGING EVENTS ───────────────────────────────────────────

        // Client can request current online list at any time (avoids missing the event)
        // Client can request current online status of THEIR conversation partners
        socket.on('get-partner-presence', async (conversationId) => {
            const { data: conv } = await adminClient
                .from('conversations')
                .select('client_id, freelancer_id')
                .eq('id', conversationId)
                .single();
            
            if (conv) {
                const partnerId = conv.client_id === userId ? conv.freelancer_id : conv.client_id;
                const isOnline = isUserOnline(partnerId);
                socket.emit('partner-presence', { conversationId, partnerId, isOnline });
            }
        });


        // Join personal room for direct events (meeting invites, notifications)
        socket.join(`user:${userId}`);

        // Track which conversations this socket has joined (for auto-rejoin)
        socket.joinedConversations = new Set();
        socket.activeCall = null; // clear any stale call state on new connection

        // ─── MESSAGING ───────────────────────────────────────────────────
        socket.on('join-conversation', async (conversationId) => {
            try {
                // Verify user is a participant
                const { data: conv, error } = await adminClient
                    .from('conversations')
                    .select('id')
                    .eq('id', conversationId)
                    .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
                    .maybeSingle();

                if (error || !conv) {
                    logger.warn(`[Socket] Unauthorized join attempt`, { userId, conversationId });
                    socket.emit('error', { message: 'Not authorized for this conversation' });
                    return;
                }

                socket.join(`conv:${conversationId}`);
                if (!socket.joinedConversations) socket.joinedConversations = new Set();
                socket.joinedConversations.add(conversationId);
                
                // Notify the room that a participant is here (context-aware presence)
                io.to(`conv:${conversationId}`).emit('partner-presence', { 
                    conversationId, 
                    userId, 
                    isOnline: true 
                });
                
                logger.log(`[Socket] ${userId} joined conv:${conversationId}`);
            } catch (err) {
                logger.error('[Socket] join-conversation error:', err);
            }
        });


        socket.on('leave-conversation', (conversationId) => {
            socket.leave(`conv:${conversationId}`);
            socket.joinedConversations?.delete(conversationId);
        });

        socket.on('send-message', async (data) => {
            // data: { conversationId, message_text, message_type, file_url, file_name }
            logger.log(`[Socket] Received message from ${userId}`, { data });
            
            try {
                const { conversationId, message_text, message_type = 'text', file_url, file_name } = data;

                // ─── ENTERPRISE ENFORCEMENT: Production Hardening ────────────
                
                // 1. Re-check Ban status (Real-time catch)
                const { data: prof } = await adminClient.from('profiles').select('is_banned').eq('user_id', userId).single();
                if (prof?.is_banned) {
                    socket.emit('error', { message: 'Your account has been banned. Message blocked.' });
                    socket.disconnect();
                    return;
                }

                // 2. Chat Gating (15-message limit for unfunded NEW contracts)
                const { data: conv } = await adminClient
                    .from('conversations')
                    .select('id, contract_id, contracts(is_grandfathered, status)')
                    .eq('id', conversationId)
                    .single();

                if (conv?.contract_id && !conv.contracts?.is_grandfathered) {
                    // Check funding status across milestones
                    const { count: fundedCount } = await adminClient
                        .from('milestones')
                        .select('id', { count: 'exact', head: true })
                        .eq('contract_id', conv.contract_id)
                        .eq('status', 'FUNDED');

                    if (!fundedCount || fundedCount === 0) {
                        // Count existing messages
                        const { count: msgCount } = await adminClient
                            .from('messages')
                            .select('id', { count: 'exact', head: true })
                            .eq('conversation_id', conversationId);

                        if (msgCount >= 15) {
                            socket.emit('chat-blocked', { 
                                current: msgCount, 
                                limit: 15, 
                                message: 'Message limit reached. Please fund a milestone to unlock unlimited chat.' 
                            });
                            return;
                        }
                    }
                }
                // ─────────────────────────────────────────────────────────────

                // 1. Moderate Message (Centralized v2 logic)
                if (message_text && message_type === 'text') {
                    const result = await moderationService.moderate(message_text, userId);
                    if (result.blocked) {
                        logger.warn(`[Socket] Message BLOCKED from ${userId}: ${message_text}`);
                        
                        // Process enforcement (Strikes/Bans/Cleanup)
                        const enforcement = await enforcementService.processViolation(userId, {
                            ...result,
                            message: message_text
                        }, conversationId);

                        socket.emit('message-blocked', {
                            reason: result.reason,
                            action: enforcement.action,
                            strikes: enforcement.strikes
                        });
                        return; // Terminate signal propagation
                    }
                }

                // 2. Save to DB
                const { data: dbMessage, error } = await adminClient

                    .from('messages')
                    .insert([{
                        conversation_id: conversationId,
                        sender_id: userId,
                        message_type: message_type,
                        message_text: message_text,
                        file_url: file_url || null,
                        file_name: file_name || null,
                        is_read: false
                    }])
                    .select()
                    .single();

                if (error) { socket.emit('error', { message: error.message }); return; }

                // Map content back to message_text for frontend compatibility
                const message = {
                    ...dbMessage,
                    message_text: dbMessage.message_text,
                    message_type: message_type,
                    file_url: file_url,
                    file_name: file_name
                };

                // Broadcast to all in the conversation room
                io.to(`conv:${conversationId}`).emit('new-message', message);

                // --- EMAIL NOTIFICATION ---
                try {
                    const { data: convRow } = await adminClient.from('conversations').select('client_id, freelancer_id').eq('id', conversationId).single();
                    if (convRow) {
                        const targetUserId = convRow.client_id === userId ? convRow.freelancer_id : convRow.client_id;
                        const { data: senderProfile } = await adminClient.from('profiles').select('name').eq('user_id', userId).maybeSingle();
                        const senderName = senderProfile?.name || 'A user';

                        // Check and send notification (only if the user is offline to avoid spam, or always if you prefer. We'll check onlineUsers map)
                        const isOnline = onlineUsers.has(targetUserId);
                        if (!isOnline) {
                            await notificationHelper.checkAndSendNotification(targetUserId, 'email_messages', { senderName });
                        }
                    }
                } catch (err) {
                    logger.error('[Socket] Failed to send message email notification:', err.message);
                }

            } catch (err) {
                logger.error('[Socket] send-message error:', err);
                socket.emit('error', { message: err.message });
            }
        });

        socket.on('typing', ({ conversationId }) => {
            socket.to(`conv:${conversationId}`).emit('user-typing', { userId });
        });

        socket.on('stop-typing', ({ conversationId }) => {
            socket.to(`conv:${conversationId}`).emit('user-stop-typing', { userId });
        });

        socket.on('mark-read', async ({ conversationId }) => {
            await supabase.from('messages')
                .update({ is_read: true })
                .eq('conversation_id', conversationId)
                .neq('sender_id', userId);
            socket.to(`conv:${conversationId}`).emit('messages-read', { conversationId, readBy: userId });
        });

        // ─── WEBRTC CALL SIGNALING (Gap #5 Hardening) ────────────────────
        socket.on('call-request', async ({ targetUserId, callType, offer }) => {
            try {
                // 1. Validate relationship: Do they have a conversation?
                const { data: conv, error: convError } = await supabase
                    .from('conversations')
                    .select('id')
                    .or(`and(participant_one_id.eq.${userId},participant_two_id.eq.${targetUserId}),and(participant_one_id.eq.${targetUserId},participant_two_id.eq.${userId})`)
                    .maybeSingle();

                if (convError || !conv) {
                    logger.warn('[Call] Unauthorized call attempt (No shared conversation):', { userId, targetUserId });
                    socket.emit('error', { message: 'You can only call users you have an active conversation with.' });
                    return;
                }

                // 2. Proceed with signal
                const targetSockets = onlineUsers.get(targetUserId);
                logger.log('[Call] Request', { userId, targetUserId, callerSocket: socket.id, targetSockets: [...(targetSockets || [])] });
                
                if (!targetSockets || targetSockets.size === 0) {
                    socket.emit('call-unavailable', { targetUserId });
                    return;
                }
                const [targetSocketId] = targetSockets;
                io.to(targetSocketId).emit('incoming-call', {
                    callerId: userId,
                    callType,
                    offer
                });
                // Store call reference so we can notify all parties
                socket.currentCallTargetSocketId = targetSocketId;
            } catch (err) {
                logger.error('[Call] Session check error:', err);
                socket.emit('error', { message: 'Failed to verify call authorization' });
            }
        });

        socket.on('call-accept', ({ callerId, answer }) => {
            const callerSockets = onlineUsers.get(callerId);
            if (!callerSockets) return;
            const [callerSocketId] = callerSockets;
            io.to(callerSocketId).emit('call-accepted', { answer });
        });

        socket.on('call-reject', ({ callerId, callType }) => {
            const callerSockets = onlineUsers.get(callerId);
            if (!callerSockets) return;
            const [callerSocketId] = callerSockets;
            io.to(callerSocketId).emit('call-rejected', { by: userId });
        });

        socket.on('ice-candidate', ({ targetUserId, candidate }) => {
            const targetSockets = onlineUsers.get(targetUserId);
            if (!targetSockets) return;
            const [targetSocketId] = targetSockets;
            io.to(targetSocketId).emit('ice-candidate', { candidate, from: userId });
        });

        socket.on('call-end', async ({ targetUserId, callType, duration, conversationId }) => {
            // Validate: only end calls that this socket actually initiated/accepted
            if (socket.activeCall && socket.activeCall.targetUserId !== targetUserId) {
                logger.warn('[Socket] call-end ignored', { userId, targetUserId, activeCallTarget: socket.activeCall.targetUserId });
                return;
            }

            // Clear active call state
            socket.activeCall = null;

            const targetSockets = onlineUsers.get(targetUserId);
            if (targetSockets) {
                const [targetSocketId] = targetSockets;
                io.to(targetSocketId).emit('call-ended', { by: userId });
            }
            // Save call log
            try {
                await supabase.from('call_logs').insert([{
                    caller_id: userId,
                    receiver_id: targetUserId,
                    call_type: callType || 'audio',
                    duration: duration || 0,
                    status: 'completed'
                }]);
            } catch (err) {
                logger.error('[Socket] Failed to save call log:', err);
            }

            // Save call message in conversation
            try {
                const dur = duration || 0;
                const mins = Math.floor(dur / 60);
                const secs = dur % 60;
                const durationText = dur > 0
                    ? `${mins > 0 ? mins + 'm ' : ''}${secs}s`
                    : 'ended';
                const icon = callType === 'video' ? '📹' : '📞';
                const messageText = `${icon} ${callType === 'video' ? 'Video' : 'Audio'} call · ${durationText}`;

                // Find conversation between caller and receiver
                const { data: conv } = await adminClient
                    .from('conversations')
                    .select('id')
                    .or(`and(client_id.eq.${userId},freelancer_id.eq.${targetUserId}),and(client_id.eq.${targetUserId},freelancer_id.eq.${userId})`)
                    .maybeSingle();

                if (conv) {
                    await adminClient.from('messages').insert([{
                        conversation_id: conv.id,
                        sender_id: userId,
                        message_text: messageText,
                        message_type: 'call',
                        is_read: false
                    }]);

                    // Emit new-message to both parties
                    const { data: msg } = await adminClient
                        .from('messages')
                        .select('*')
                        .eq('conversation_id', conv.id)
                        .eq('sender_id', userId)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (msg) {
                        const payload = { ...msg, conversationId: conv.id };
                        io.to(`conv:${conv.id}`).emit('new-message', payload);
                        // Also emit directly to both users
                        const callerSockets = onlineUsers.get(userId);
                        const receiverSockets = onlineUsers.get(targetUserId);
                        callerSockets?.forEach(sid => io.to(sid).emit('new-message', payload));
                        receiverSockets?.forEach(sid => io.to(sid).emit('new-message', payload));
                    }
                }
            } catch (err) {
                logger.error('[Socket] Failed to save call message:', err);
            }
        });

        // ─── DISCONNECT ──────────────────────────────────────────────────
        socket.on('disconnect', () => {
            // ─── SQL PRESENCE CLEANUP ───
            // 1. Delete active session
            adminClient.from('active_sessions').delete().eq('socket_id', socket.id)
                .catch(err => logger.error('[Socket] Failed to delete active session:', err));

            // 2. Update session history logout time
            if (socket.historyId) {
                const logoutTime = new Date();
                adminClient.from('session_history')
                    .update({
                        logout_at: logoutTime.toISOString(),
                        termination_reason: 'disconnect'
                    })
                    .eq('id', socket.historyId)
                    .catch(err => logger.error('[Socket] Failed to update session history:', err));
            }

            if (userId) {
                const sockets = onlineUsers.get(userId);
                if (sockets) {
                    sockets.delete(socket.id);
                    if (sockets.size === 0) {
                        onlineUsers.delete(userId);
                        userOnlinePreferences.delete(userId);

                        // Update presence tables to offline / inactive
                        adminClient.from('user_presence').update({
                            status: 'offline',
                            last_seen: new Date().toISOString()
                        }).eq('user_id', userId).catch(err => logger.error('[Socket] Failed to update user presence to offline:', err));

                        if (socket.isAdmin) {
                            adminClient.from('admin_presence').update({
                                status: 'inactive',
                                last_active: new Date().toISOString()
                            }).eq('admin_id', userId).catch(err => logger.error('[Socket] Failed to update admin presence to inactive:', err));
                        }

                        adminClient.from('presence_events').insert([{
                            user_id: userId,
                            event_type: 'logout'
                        }]).catch(err => logger.error('[Socket] Failed to log presence event:', err));

                        // Broadcast offline status to conversation partners
                        adminClient
                            .from('conversations')
                            .select('id')
                            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
                            .then(({ data: conversations }) => {
                                if (conversations) {
                                    for (const conv of conversations) {
                                        io.to(`conv:${conv.id}`).emit('partner-presence', {
                                            conversationId: conv.id,
                                            userId,
                                            isOnline: false
                                        });
                                    }
                                }
                            })
                            .catch(err => logger.error('[Socket] Disconnect presence broadcast error:', err));
                    }
                }
            }
            strikeCounts.delete(socket.id);
            // If this socket had an active call, notify the other party
            if (socket.activeCall?.targetUserId) {
                const targetSockets = onlineUsers.get(socket.activeCall.targetUserId);
                if (targetSockets && targetSockets.size > 0) {
                    const [targetSocketId] = targetSockets;
                    io.to(targetSocketId).emit('call-ended', {
                        by: userId,
                        reason: 'disconnected'
                    });
                }
            }
            logger.log(`[Socket] Disconnected: ${userId} (${socket.id})`);
        });
    });

    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
}

function isUserOnline(userId) {
    const pref = userOnlinePreferences.get(userId) !== false;
    if (!pref) return false;

    const sockets = onlineUsers.get(userId);
    const hasSocket = sockets && sockets.size > 0;
    const lastSeen = heartbeats.get(userId);
    const recentHeartbeat = lastSeen && (Date.now() - lastSeen < HEARTBEAT_TIMEOUT);
    return hasSocket || recentHeartbeat;
}

function getOnlineUsers() {
    return [...onlineUsers.keys()].filter(uid => isUserOnline(uid));
}

module.exports = { initSocketIO, getIO, isUserOnline, getOnlineUsers };

