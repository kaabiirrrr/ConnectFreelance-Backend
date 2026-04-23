const supabase = require('../supabase/client');
const logger = require('../utils/logger');

/**
 * POST /api/problems/submit
 * Public endpoint to submit a problem.
 */
exports.submitProblem = async (req, res, next) => {
    try {
        const { firstName, lastName, email, description } = req.body;

        if (!firstName || !lastName || !email || !description) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const { data, error } = await supabase
            .from('user_problems')
            .insert([{
                first_name: firstName,
                last_name: lastName,
                email,
                problem_description: description,
                status: 'pending'
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data,
            message: 'Your problem has been submitted successfully. Our team will get back to you soon.'
        });
    } catch (error) {
        logger.error('Error in submitProblem', error);
        next(error);
    }
};
