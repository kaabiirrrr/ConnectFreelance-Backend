const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

exports.getAllJobs = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('jobs')
            .select(`
                *,
                client:users!client_id(email, profiles(name, avatar_url))
            `, { count: 'exact' });

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

exports.removeJob = async (req, res, next) => {
    try {
        const { id } = req.params;

        // In a real app we might soft-delete or change status to 'CANCELLED'
        const { error } = await supabase
            .from('jobs')
            .delete()
            .eq('id', id);

        if (error) throw error;

        await logAction(req.user.id, 'JOB_DELETE', id, `Permanently deleted job ID: ${id}`);

        res.status(200).json({ success: true, message: 'Job removed successfully' });
    } catch (error) {
        next(error);
    }
};

exports.approveJob = async (req, res, next) => {
    try {
        const { id } = req.params;
        // Assume jobs have an 'is_approved' column or similar if requiring manual approval
        // Here we just update updated_at as a placeholder if there isn't one
        const { error } = await supabase
            .from('jobs')
            .update({ updated_at: new Date() })
            .eq('id', id);

        if (error) throw error;

        await logAction(req.user.id, 'JOB_APPROVE', id, `Approved job ID: ${id}`);

        res.status(200).json({ success: true, message: 'Job approved successfully.' });
    } catch (error) {
        next(error);
    }
};

exports.rejectJob = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const { error } = await supabase
            .from('jobs')
            .update({
                status: 'REJECTED',
                updated_at: new Date(),
                admin_notes: reason
            })
            .eq('id', id);

        if (error) throw error;

        await logAction(req.user.id, 'JOB_REJECT', id, `Rejected job ID: ${id}. Reason: ${reason || 'N/A'}`);

        res.status(200).json({ success: true, message: 'Job rejected successfully.' });
    } catch (error) {
        next(error);
    }
};
