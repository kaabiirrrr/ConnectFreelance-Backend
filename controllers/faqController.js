const supabase = require('../supabase/client');
const logger = require('../utils/logger');

/**
 * POST /api/faqs/submit
 * Public endpoint to submit a new question for the FAQ.
 */
exports.submitQuestion = async (req, res, next) => {
    try {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({ success: false, message: 'Question is required' });
        }

        const { data, error } = await supabase
            .from('faqs')
            .insert([{ question, status: 'pending' }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data,
            message: 'Your question has been submitted successfully. Our team will answer it soon.'
        });
    } catch (error) {
        logger.error('Error in submitQuestion', error);
        next(error);
    }
};

/**
 * GET /api/faqs/published
 * Public endpoint to fetch all published FAQs.
 */
exports.getPublishedFAQs = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('faqs')
            .select('question, answer')
            .eq('status', 'published')
            .order('created_at', { ascending: true });

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('Error in getPublishedFAQs', error);
        next(error);
    }
};
