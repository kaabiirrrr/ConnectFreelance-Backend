const supabase = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

/**
 * GET /api/admin/sales-proposals
 * Returns all submitted membership proposals/enterprise requests for admins.
 */
exports.getSalesProposals = async (req, res, next) => {
    try {
        const { status } = req.query;

        let query = supabase
            .from('membership_proposals')
            .select('*')
            .order('created_at', { ascending: false });

        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        // Enrich with profile data (same pattern as UsersTable)
        const userIds = [...new Set((data || []).map(p => p.user_id).filter(Boolean))];
        let profileMap = {};
        if (userIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('user_id, name, avatar_url')
                .in('user_id', userIds);
            (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
        }

        const enriched = (data || []).map(p => ({
            ...p,
            profile: profileMap[p.user_id] || null
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (error) {
        logger.error('[AdminSalesProposal] Error in getSalesProposals', error);
        next(error);
    }
};

/**
 * PATCH /api/admin/sales-proposals/:id
 * Updates the status and details of a sales proposal (e.g., mark as resolved, write a custom proposal).
 */
exports.updateSalesProposalStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, admin_comment, custom_price, custom_connects, custom_features, custom_duration } = req.body;

        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

        const updateData = { 
            status, 
            updated_at: new Date().toISOString() 
        };

        if (admin_comment !== undefined) updateData.admin_comment = admin_comment;
        if (custom_price !== undefined) updateData.custom_price = custom_price ? Number(custom_price) : null;
        if (custom_connects !== undefined) updateData.custom_connects = custom_connects ? Number(custom_connects) : null;
        if (custom_features !== undefined) updateData.custom_features = custom_features;
        if (custom_duration !== undefined) updateData.custom_duration = custom_duration;

        // If the admin sets a custom price and connects, mark the proposal with proposed_at timestamp
        if (custom_price && custom_connects) {
            updateData.proposed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('membership_proposals')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: `Proposal updated successfully` });
    } catch (error) {
        logger.error('[AdminSalesProposal] Error in updateSalesProposalStatus', error);
        next(error);
    }
};

/**
 * DELETE /api/admin/sales-proposals/:id
 * Deletes a sales proposal from the database.
 */
exports.deleteSalesProposal = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('membership_proposals')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Proposal request deleted successfully' });
    } catch (error) {
        logger.error('[AdminSalesProposal] Error in deleteSalesProposal', error);
        next(error);
    }
};
