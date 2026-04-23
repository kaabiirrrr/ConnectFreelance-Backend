const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

exports.getAllProposals = async (req, res, next) => {
    try {
        const { limit = 50, offset = 0 } = req.query;

        const { data, count, error } = await supabase
            .from('proposals')
            .select(`
                *,
                job:jobs(
                    id,
                    title,
                    description,
                    budget,
                    budget_amount,
                    budget_type,
                    category,
                    skills,
                    client:users!client_id(
                        email, 
                        profiles(name, avatar_url)
                    )
                ),
                freelancer:users!freelancer_id(email, profiles(name, avatar_url))
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.removeProposal = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('proposals')
            .delete()
            .eq('id', id);

        if (error) throw error;

        await logAction(req.user.id, 'PROPOSAL_DELETE', id, `Deleted proposal ID: ${id}`);

        res.status(200).json({ success: true, message: 'Proposal removed successfully' });
    } catch (error) {
        next(error);
    }
};
