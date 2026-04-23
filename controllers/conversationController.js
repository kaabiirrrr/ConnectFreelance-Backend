const adminClient = require('../supabase/adminClient');

// Get or create a conversation — creates as 'pending' if new (request system)
exports.getOrCreateConversation = async (req, res, next) => {
    try {
        const otherId = req.body.freelancer_id || req.body.other_user_id || req.body.userId || req.body.participant_id || req.body.user_id;
        const currentUserId = req.user.id;

        if (!otherId) return res.status(400).json({ success: false, message: 'Recipient user ID is required' });
        if (otherId === currentUserId) return res.status(400).json({ success: false, message: 'Cannot start a conversation with yourself' });

        // Check if blocked
        const { data: blocked } = await adminClient
            .from('blocked_users')
            .select('blocker_id')
            .or(`and(blocker_id.eq.${currentUserId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${currentUserId})`)
            .maybeSingle();

        if (blocked) return res.status(403).json({ success: false, message: 'Cannot start conversation — user is blocked' });

        // Try to find existing
        const { data: existing, error: findError } = await adminClient
            .from('conversations')
            .select('id, client_id, freelancer_id, status')
            .or(`and(client_id.eq.${currentUserId},freelancer_id.eq.${otherId}),and(client_id.eq.${otherId},freelancer_id.eq.${currentUserId})`)
            .maybeSingle();

        if (findError) throw findError;

        if (existing) return res.status(200).json({ success: true, data: existing });


        // Create as pending — recipient must accept before chat opens
        const { data: newConv, error } = await adminClient
            .from('conversations')
            .insert([{ client_id: currentUserId, freelancer_id: otherId, status: 'pending' }])
            .select('id, client_id, freelancer_id, status')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data: newConv });
    } catch (err) {
        next(err);
    }
};

// Get all ACCEPTED conversations for the logged-in user
exports.getMyConversations = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Build query — filter by status only if the column exists
        let { data: convs, error } = await adminClient
            .from('conversations')
            .select('id, client_id, freelancer_id, status, created_at, updated_at')
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        // FALLBACK: If updated_at is missing, retry without it
        if (error && error.code === '42703') {
            const { data: fbData, error: fbError } = await adminClient
                .from('conversations')
                .select('id, client_id, freelancer_id, status, created_at')
                .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
                .order('created_at', { ascending: false });
            
            if (fbError) throw fbError;
            convs = fbData;
            error = null;
        }

        if (error) throw error;

        if (!convs || convs.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Filter accepted (or all if status column not yet migrated)
        const filtered = convs.filter(c => !c.status || c.status === 'accepted');

        // Collect all distinct profile IDs
        const profileIds = [...new Set(filtered.flatMap(c => [c.client_id, c.freelancer_id]).filter(Boolean))];
        
        let profileMap = {};
        if (profileIds.length > 0) {
            const { data: profiles } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url, role')
                .in('user_id', profileIds);
            if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });
        }

        // Count unread for each conversation and map profiles
        const enrichedData = await Promise.all(filtered.map(async (conv) => {
            // Unread count
            const { count } = await adminClient
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', conv.id)
                .eq('is_read', false)
                .neq('sender_id', userId);
                
            // Latest message
            const { data: latestMessageArray } = await adminClient
                .from('messages')
                .select('message_text, created_at')
                .eq('conversation_id', conv.id)
                .order('created_at', { ascending: false })
                .limit(1);
            
            const latestMsg = latestMessageArray && latestMessageArray.length > 0 ? latestMessageArray[0] : null;
            const messageContent = latestMsg ? latestMsg.message_text : null;

            return {
                ...conv,
                unread_count: count || 0,
                last_message: messageContent,
                last_message_at: latestMsg ? latestMsg.created_at : conv.created_at,
                client: profileMap[conv.client_id] || null,
                freelancer: profileMap[conv.freelancer_id] || null
            };
        }));

        res.status(200).json({ success: true, data: enrichedData });
    } catch (err) {
        next(err);
    }
};

// Get messages in a conversation (paginated)
exports.getMessages = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const { data: conv } = await adminClient
            .from('conversations')
            .select('client_id, freelancer_id')
            .eq('id', conversationId)
            .maybeSingle();

        if (!conv || (conv.client_id !== userId && conv.freelancer_id !== userId)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const otherId = conv.client_id === userId ? conv.freelancer_id : conv.client_id;

        const { data: messages, error } = await adminClient
            .from('messages')
            .select('id, conversation_id, sender_id, message_text, message_type, is_read, created_at')

            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Fetch sender profiles manually
        const senderIds = [...new Set((messages || []).map(m => m.sender_id).filter(Boolean))];
        let senderMap = {};
        if (senderIds.length > 0) {
            const { data: profiles } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url')
                .in('user_id', senderIds);
            if (profiles) profiles.forEach(p => { senderMap[p.user_id] = p; });
        }


        const enrichedMessages = (messages || []).map(m => ({
            ...m,
            message_text: m.message_text,
            message_type: m.message_type || 'text',
            sender: senderMap[m.sender_id] || null
        }));

        // Mark messages from the other user as read

        await adminClient.from('messages')
            .update({ is_read: true })
            .eq('conversation_id', conversationId)
            .neq('sender_id', userId)
            .eq('is_read', false);

        res.status(200).json({ success: true, data: enrichedMessages.reverse() });
    } catch (err) {
        next(err);
    }
};

// Get pending conversation requests
exports.getConversationRequests = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('conversations')
            .select('id, client_id, freelancer_id, status, created_at')
            .eq('status', 'pending')
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`);

        if (error) throw error;

        // Fetch other user profiles
        const enriched = await Promise.all((data || []).map(async (conv) => {
            const otherId = conv.client_id === userId ? conv.freelancer_id : conv.client_id;
            const { data: profile } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url, role')
                .eq('user_id', otherId)
                .single();
            
            return { ...conv, other_user: profile };
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        next(err);
    }
};

// Accept conversation request
exports.acceptConversationRequest = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('conversations')
            .update({ status: 'accepted' })
            .eq('id', conversationId)
            // Ensure the user is a participant before they can accept
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
            .select('id, status')
            .single();

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Conversation accepted', data });
    } catch (err) {
        next(err);
    }
};

// Reject conversation request
exports.rejectConversationRequest = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        const { error } = await adminClient
            .from('conversations')
            .update({ status: 'rejected' })
            .eq('id', conversationId)
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Conversation rejected' });
    } catch (err) {
        next(err);
    }
};

// Block a user
exports.blockUser = async (req, res, next) => {
    try {
        const blockerId = req.user.id;
        const { userId: blockedId } = req.params;

        const { error } = await adminClient
            .from('blocked_users')
            .insert([{ blocker_id: blockerId, blocked_id: blockedId }]);

        if (error && error.code !== '23505') throw error; // Ignore if already blocked
        res.status(200).json({ success: true, message: 'User blocked successfully' });
    } catch (err) {
        next(err);
    }
};

// Unblock a user
exports.unblockUser = async (req, res, next) => {
    try {
        const blockerId = req.user.id;
        const { userId: blockedId } = req.params;

        const { error } = await adminClient
            .from('blocked_users')
            .delete()
            .eq('blocker_id', blockerId)
            .eq('blocked_id', blockedId);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'User unblocked successfully' });
    } catch (err) {
        next(err);
    }
};

// Get blocked status
exports.getBlockStatus = async (req, res, next) => {
    try {
        const blockerId = req.user.id;
        const { userId: blockedId } = req.params;

        const { data, error } = await adminClient
            .from('blocked_users')
            .select('blocker_id, blocked_id')
            .eq('blocker_id', blockerId)
            .eq('blocked_id', blockedId)
            .maybeSingle();

        if (error) throw error;
        res.status(200).json({ success: true, isBlocked: !!data });
    } catch (err) {
        next(err);
    }
};

// Get block list
exports.getBlockList = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', userId);

        if (error) throw error;

        const profileIds = data.map(b => b.blocked_id);
        if (profileIds.length === 0) return res.status(200).json({ success: true, data: [] });

        const { data: profiles } = await adminClient
            .from('profiles')
            .select('user_id, name, avatar_url, role')
            .in('user_id', profileIds);

        res.status(200).json({ success: true, data: profiles || [] });
    } catch (err) {
        next(err);
    }
};

// Report a user
exports.reportUser = async (req, res, next) => {
    try {
        const reporterId = req.user.id;
        const { userId: reportedId } = req.params;
        const { reason } = req.body;

        const { error } = await adminClient
            .from('user_reports')
            .insert([{ reporter_id: reporterId, reported_id: reportedId, reason }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'User reported successfully' });
    } catch (err) {
        next(err);
    }
};

// Mute a conversation
exports.muteConversation = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { conversationId } = req.params;

        // Verify participant
        const { data: conv } = await adminClient
            .from('conversations')
            .select('id')
            .eq('id', conversationId)
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
            .maybeSingle();

        if (!conv) {
            return res.status(403).json({ success: false, message: 'Not authorized for this conversation' });
        }

        const { error } = await adminClient
            .from('muted_conversations')
            .upsert([{ user_id: userId, conversation_id: conversationId }], { onConflict: 'user_id,conversation_id' });

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Conversation muted' });
    } catch (err) {
        next(err);
    }
};

// Unmute a conversation
exports.unmuteConversation = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { conversationId } = req.params;

        const { error } = await adminClient
            .from('muted_conversations')
            .delete()
            .eq('user_id', userId)
            .eq('conversation_id', conversationId);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Conversation unmuted' });
    } catch (err) {
        next(err);
    }
};

// Get mute status
exports.getMuteStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { conversationId } = req.params;

        const { data, error } = await adminClient
            .from('muted_conversations')
            .select('user_id, conversation_id')
            .eq('user_id', userId)
            .eq('conversation_id', conversationId)
            .maybeSingle();

        if (error) throw error;
        res.status(200).json({ success: true, isMuted: !!data });
    } catch (err) {
        next(err);
    }
};

// Clear conversation (Hard delete messages for this conversation)
exports.clearConversation = async (req, res, next) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // Verify participant
        const { data: conv } = await adminClient
            .from('conversations')
            .select('id')
            .eq('id', conversationId)
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`)
            .maybeSingle();

        if (!conv) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { error } = await adminClient
            .from('messages')
            .delete()
            .eq('conversation_id', conversationId);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Conversation cleared' });
    } catch (err) {
        next(err);
    }
};

