const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

exports.getAllContracts = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('contracts')
            .select(`
                *,
                job:jobs(title, description, category, skills, budget_amount, budget_type),
                client:users!client_id(email, profiles(name, avatar_url)),
                freelancer:users!freelancer_id(email, profiles(name, avatar_url))
            `, { count: 'exact' })

        if (status) {
            query = query.eq('status', status.toUpperCase());
        }

        const { data, count, error } = await query
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

exports.cancelContract = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const { error } = await supabase
            .from('contracts')
            .update({
                status: 'CANCELLED',
                updated_at: new Date()
            })
            .eq('id', id);

        if (error) throw error;

        await logAction(req.user.id, 'CONTRACT_CANCEL', id, `Cancelled contract ID: ${id}. Reason: ${reason || 'N/A'}`);

        res.status(200).json({ success: true, message: 'Contract cancelled successfully' });
    } catch (error) {
        next(error);
    }
};
