const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const relationshipService = require('../services/relationshipService');
const logger = require('../utils/logger');

/**
 * Create a review for a completed contract
 * POST /api/reviews/create
 * Security: Only contract participants can review, only after contract is COMPLETED
 */
exports.createReview = async (req, res, next) => {
    try {
        const { contract_id, rating, comment } = req.body;
        const reviewerId = req.user.id;

        // 1. Fetch the contract and verify it's completed
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, client_id, freelancer_id, status')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Reviews can only be submitted for completed contracts' });
        }

        // 2. Verify the reviewer is a participant in this contract
        const isClient = contract.client_id === reviewerId;
        const isFreelancer = contract.freelancer_id === reviewerId;

        if (!isClient && !isFreelancer) {
            return res.status(403).json({ success: false, message: 'You are not a participant in this contract' });
        }

        // 3. Determine who is being reviewed (the other party)
        const revieweeId = isClient ? contract.freelancer_id : contract.client_id;

        // 4. Check for duplicate review (UNIQUE constraint will also catch this)
        const { data: existing } = await supabase
            .from('reviews')
            .select('id')
            .eq('contract_id', contract_id)
            .eq('reviewer_id', reviewerId)
            .maybeSingle();

        if (existing) {
            return res.status(409).json({ success: false, message: 'You have already reviewed this contract' });
        }

        // 5. Insert the review
        const { data: review, error } = await supabase
            .from('reviews')
            .insert([{
                contract_id,
                reviewer_id: reviewerId,
                reviewee_id: revieweeId,
                rating,
                comment: comment || null
            }])
            .select('id, contract_id, reviewer_id, reviewee_id, rating, comment, created_at')
            .single();

        if (error) throw error;

        // 6. Notify the reviewee
        await supabase.from('notifications').insert([{
            user_id: revieweeId,
            title: 'New Review',
            content: `You received a ${rating}-star review`,
        }]).catch(() => {});

        // 7. Sync Relationship Stats (Trust Graph v2) - Review impacts Communication & Trust Score
        relationshipService.syncRelationshipStats(contract.client_id, contract.freelancer_id).catch(err => {
            logger.error('[RelationshipSync] Failed in review creation', err);
        });

        res.status(201).json({ success: true, data: review, message: 'Review submitted successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * Get reviews for a user (with reviewer info and average rating)
 * GET /api/reviews/user/:id
 * Security: Public endpoint
 */
exports.getUserReviews = async (req, res, next) => {
    try {
        const { id } = req.params;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
        const offset = (page - 1) * limit;

        // Fetch reviews with reviewer name
        const { data: reviews, error, count } = await supabase
            .from('reviews')
            .select(`
                id, rating, comment, created_at,
                reviewer:reviewer_id ( user_id, name, avatar_url )
            `, { count: 'exact' })
            .eq('reviewee_id', id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Calculate average rating
        const { data: avgData } = await supabase
            .rpc('avg_rating', { user_id_input: id })
            .maybeSingle();

        // Fallback: manual calculation if RPC doesn't exist
        let avgRating = avgData?.avg_rating || null;
        if (avgRating === null && reviews && reviews.length > 0) {
            const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
            avgRating = parseFloat((sum / reviews.length).toFixed(1));
        }

        const totalPages = Math.ceil((count || 0) / limit);

        res.status(200).json({
            success: true,
            data: {
                reviews: reviews || [],
                average_rating: avgRating || 0,
                total_reviews: count || 0
            },
            pagination: { page, limit, total: count || 0, totalPages }
        });
    } catch (error) {
        next(error);
    }
};
