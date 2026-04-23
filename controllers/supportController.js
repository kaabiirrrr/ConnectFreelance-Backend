const supabase = require('../supabase/client');
const { notifyUser } = require('./notificationController');
const logger = require('../utils/logger');

/**
 * POST /api/support/create
 * Authenticated endpoint to create a support ticket.
 */
exports.createTicket = async (req, res, next) => {
    try {
        const { userId, subject, message, category } = req.body;

        if (!userId || !subject || !message || !category) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const { data, error } = await supabase
            .from('support_tickets')
            .insert([{
                user_id: userId,
                subject,
                message,
                category: category.toUpperCase(),
                status: 'pending',
                priority: 'normal'
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data,
            message: 'Your request has been submitted. We will respond within 48 hours.'
        });
    } catch (error) {
        logger.error('[SupportController] Error in createTicket', error);
        next(error);
    }
};

/**
 * GET /api/support/my-tickets
 * Authenticated endpoint to fetch a user's ticket history.
 */
exports.getUserTickets = async (req, res, next) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        logger.error('[SupportController] Error in getUserTickets', error);
        next(error);
    }
};

/**
 * GET /api/support/admin/all-tickets
 * Admin-only endpoint to fetch all support tickets.
 */
exports.getAllTickets = async (req, res, next) => {
    try {
        const { status } = req.query;

        let query = supabase
            .from('support_tickets')
            .select(`
                *,
                profiles:profiles!support_tickets_user_id_profiles_fkey (
                    name,
                    avatar_url,
                    email
                ),
                assigned_admin:profiles!support_tickets_assigned_to_fkey (
                    name,
                    avatar_url
                )
            `)
            .order('created_at', { ascending: false });

        if (status && status !== 'all') {
            query = query.eq('status', status.toLowerCase());
        }

        const { data, error } = await query;
        if (error) throw error;

        // Apply 48-hour escalation logic
        const enhancedData = data.map(ticket => {
            const createdAt = new Date(ticket.created_at);
            const now = new Date();
            const hoursDiff = (now - createdAt) / (1000 * 60 * 60);

            if (ticket.status !== 'resolved' && hoursDiff > 48) {
                return { ...ticket, priority: 'high', escalated: true };
            }
            return { ...ticket, escalated: false };
        });

        res.status(200).json({
            success: true,
            data: enhancedData
        });
    } catch (error) {
        logger.error('[SupportController] Error in getAllTickets', error);
        next(error);
    }
};

/**
 * GET /api/support/admin/ticket/:id
 * Admin-only endpoint to fetch ticket details and messages.
 */
exports.getTicketDetails = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select(`
                *,
                profiles:profiles!support_tickets_user_id_profiles_fkey (
                    name,
                    avatar_url,
                    email
                ),
                assigned_admin:profiles!support_tickets_assigned_to_fkey (
                    name,
                    avatar_url
                )
            `)
            .eq('id', id)
            .single();

        if (ticketError) throw ticketError;

        const { data: messages, error: messagesError } = await supabase
            .from('support_ticket_messages')
            .select(`
                *,
                sender:sender_id (
                    name,
                    avatar_url
                )
            `)
            .eq('ticket_id', id)
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;

        res.status(200).json({
            success: true,
            data: {
                ...ticket,
                messages
            }
        });
    } catch (error) {
        logger.error('[SupportController] Error in getTicketDetails', error);
        next(error);
    }
};

/**
 * PATCH /api/support/admin/assign/:id
 * Admin-only endpoint to assign a ticket to an admin.
 */
exports.assignTicket = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id; // From protectAdmin middleware

        const { data, error } = await supabase
            .from('support_tickets')
            .update({ 
                assigned_to: adminId,
                status: 'in_progress' 
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify user
        await notifyUser(data.user_id, {
            title: 'Support Ticket Assigned',
            content: `Your ticket regarding "${data.subject}" has been assigned to an agent and is now in progress.`,
            type: 'SUPPORT',
            link: `/dashboard/support`
        });

        res.status(200).json({
            success: true,
            data,
            message: 'Ticket assigned successfully'
        });
    } catch (error) {
        logger.error('[SupportController] Error in assignTicket', error);
        next(error);
    }
};

/**
 * PATCH /api/support/admin/update-status/:id
 * Admin-only endpoint to update ticket status.
 */
exports.updateTicketStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const updateData = { status: status.toLowerCase() };
        if (status.toLowerCase() === 'resolved') {
            updateData.resolved_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('support_tickets')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify user if resolved
        if (status.toLowerCase() === 'resolved') {
            await notifyUser(data.user_id, {
                title: 'Ticket Resolved',
                content: `Your support ticket "${data.subject}" has been marked as resolved.`,
                type: 'SUCCESS',
                link: `/dashboard/support`
            });
        }

        res.status(200).json({
            success: true,
            data,
            message: `Ticket marked as ${status}`
        });
    } catch (error) {
        logger.error('[SupportController] Error in updateTicketStatus', error);
        next(error);
    }
};

/**
 * POST /api/support/admin/message
 * Admin-only endpoint to send a message on a ticket.
 */
exports.addTicketMessage = async (req, res, next) => {
    try {
        const { ticketId, message } = req.body;
        const adminId = req.user.id;

        if (!ticketId || !message) {
            return res.status(400).json({ success: false, message: 'Ticket ID and message are required' });
        }

        // 1. Insert message
        const { data: newMessage, error: messageError } = await supabase
            .from('support_ticket_messages')
            .insert([{
                ticket_id: ticketId,
                sender_id: adminId,
                message
            }])
            .select(`
                *,
                sender:sender_id (
                    name,
                    avatar_url
                )
            `)
            .single();

        if (messageError) throw messageError;

        // 2. Get ticket info for notification
        const { data: ticket } = await supabase
            .from('support_tickets')
            .select('user_id, subject')
            .eq('id', ticketId)
            .single();

        // 3. Notify user
        if (ticket) {
            await notifyUser(ticket.user_id, {
                title: 'New Support Message',
                content: `An agent has replied to your ticket: "${ticket.subject}"`,
                type: 'MESSAGE',
                link: `/dashboard/support`
            });
        }

        res.status(201).json({
            success: true,
            data: newMessage,
            message: 'Message sent successfully'
        });
    } catch (error) {
        logger.error('[SupportController] Error in addTicketMessage', error);
        next(error);
    }
};

/**
 * GET /api/support/ticket/:id/messages
 * Fetch messages for a specific ticket (Authenticated).
 */
exports.getTicketMessages = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('support_ticket_messages')
            .select(`
                *,
                sender:sender_id (
                    name,
                    avatar_url
                )
            `)
            .eq('ticket_id', id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        logger.error('[SupportController] Error in getTicketMessages', error);
        next(error);
    }
};
