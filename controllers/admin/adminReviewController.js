const supabase = require('../../supabase/client');
const logger = require('../../utils/logger');

/**
 * Get all project reviews for admin moderation
 */
exports.getProjectReviews = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                *,
                reviewer:profiles!reviews_reviewer_id_profiles_fkey(name, avatar_url, email),
                reviewee:profiles!reviews_reviewee_id_profiles_fkey(name, avatar_url, email),
                contract:contracts!reviews_contract_id_fkey(title, status)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        logger.error('Error fetching project reviews', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch project reviews',
            error: error.message
        });
    }
};

/**
 * Get all site reviews
 */
exports.getSiteReviews = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('site_reviews')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        logger.error('Error fetching site reviews', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch site reviews',
            error: error.message
        });
    }
};

/**
 * Delete a review (project or site)
 */
exports.deleteReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query; // 'project' or 'site'

        const table = type === 'site' ? 'site_reviews' : 'reviews';

        const { error } = await supabase
            .from(table)
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({
            success: true,
            message: `${type === 'site' ? 'Site' : 'Project'} review deleted successfully`
        });
    } catch (error) {
        logger.error('Error deleting review', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete review',
            error: error.message
        });
    }
};
