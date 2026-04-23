const supabase = require('../../supabase/client');
const logger = require('../../utils/logger');

/**
 * GET /api/admin/problems
 * Returns all submitted user problems for admins.
 */
exports.getProblems = async (req, res, next) => {
    try {
        const { status } = req.query;

        let query = supabase
            .from('user_problems')
            .select('*')
            .order('created_at', { ascending: false });

        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('[AdminProblem] Error in getProblems', error);
        next(error);
    }
};

/**
 * PATCH /api/admin/problems/:id
 * Updates the status of a user problem (e.g., mark as resolved).
 */
exports.updateProblemStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

        const { data, error } = await supabase
            .from('user_problems')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: `Problem marked as ${status}` });
    } catch (error) {
        logger.error('[AdminProblem] Error in updateProblemStatus', error);
        next(error);
    }
};

/**
 * DELETE /api/admin/problems/:id
 * Deletes a user problem from the database.
 */
exports.deleteProblem = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('user_problems')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Problem entry deleted successfully' });
    } catch (error) {
        logger.error('[AdminProblem] Error in deleteProblem', error);
        next(error);
    }
};
