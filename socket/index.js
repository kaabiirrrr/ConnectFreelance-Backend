const { Server } = require('socket.io');
const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const moderationService = require('../services/moderationService');
const enforcementService = require('../services/enforcementService');


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
                .select('is_banned, is_restricted')
                .eq('user_id', user.id)
                .single();

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

        // Track online status
        if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socket.id);
        
        // --- 🛡️ BANK-GRADE: PRIVACY HARDENING ---
        // io.emit('online-users', [...onlineUsers.keys()]); // REMOVED: Do not broadcast globally


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
                const isOnline = onlineUsers.has(partnerId);
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
            if (userId) {
                const sockets = onlineUsers.get(userId);
                if (sockets) {
                    sockets.delete(socket.id);
                    if (sockets.size === 0) onlineUsers.delete(userId);
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
    const sockets = onlineUsers.get(userId);
    const hasSocket = sockets && sockets.size > 0;
    const lastSeen = heartbeats.get(userId);
    const recentHeartbeat = lastSeen && (Date.now() - lastSeen < HEARTBEAT_TIMEOUT);
    return hasSocket || recentHeartbeat;
}

function getOnlineUsers() {
    return [...onlineUsers.keys()];
}

module.exports = { initSocketIO, getIO, isUserOnline, getOnlineUsers };

