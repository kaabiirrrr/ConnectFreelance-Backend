const supabase = require('../../supabase/client');
const logger = require('../../utils/logger');

/**
 * GET /api/admin/faqs
 * Returns all FAQs, including pending/published ones.
 */
exports.getAllFAQs = async (req, res, next) => {
    try {
        const { status } = req.query;

        let query = supabase
            .from('faqs')
            .select('*')
            .order('created_at', { ascending: false });

        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('[AdminFAQ] Error in getAllFAQs', error);
        next(error);
    }
};

/**
 * PATCH /api/admin/faqs/:id
 * Updates an FAQ entry (e.g., provides an answer and marks as published).
 */
exports.updateFAQ = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { question, answer, status } = req.body;

        const updateData = {};
        if (question) updateData.question = question;
        if (answer !== undefined) updateData.answer = answer; // Accept empty string or clear answer
        if (status) updateData.status = status;

        const { data, error } = await supabase
            .from('faqs')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'FAQ entry updated successfully' });
    } catch (error) {
        logger.error('[AdminFAQ] Error in updateFAQ', error);
        next(error);
    }
};

/**
 * DELETE /api/admin/faqs/:id
 */
exports.deleteFAQ = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('faqs')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'FAQ entry deleted successfully' });
    } catch (error) {
        logger.error('[AdminFAQ] Error in deleteFAQ', error);
        next(error);
    }
};
