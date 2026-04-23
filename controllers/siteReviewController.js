const supabase = require('../supabase/client');

/**
 * Get latest site reviews (public, no auth required)
 * GET /api/site-reviews
 */
exports.getReviews = async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 4, 20);

        const { data, error, count } = await supabase
            .from('site_reviews')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        // Calculate average rating from ALL reviews (not just limited set)
        const { data: allRatings } = await supabase
            .from('site_reviews')
            .select('rating');

        let avgRating = 0;
        const totalCount = allRatings?.length || 0;
        if (totalCount > 0) {
            const sum = allRatings.reduce((acc, r) => acc + r.rating, 0);
            avgRating = parseFloat((sum / totalCount).toFixed(1));
        }

        res.status(200).json({
            success: true,
            data: data || [],
            meta: {
                avg_rating: avgRating,
                total_reviews: totalCount
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Submit a site review (public, no auth required)
 * POST /api/site-reviews
 */
exports.addReview = async (req, res, next) => {
    try {
        const { name, rating, comment } = req.body;

        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
        }
        if (!comment || !comment.trim()) {
            return res.status(400).json({ success: false, message: 'Comment is required' });
        }
        if (comment.length > 1000) {
            return res.status(400).json({ success: false, message: 'Comment must be less than 1000 characters' });
        }

        const { data, error } = await supabase
            .from('site_reviews')
            .insert([{
                name: name.trim(),
                rating,
                comment: comment.trim()
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data,
            message: 'Review submitted successfully!'
        });
    } catch (error) {
        next(error);
    }
};
