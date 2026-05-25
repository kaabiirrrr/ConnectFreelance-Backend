const adminClient = require('../supabase/adminClient');

/**
 * POST /api/services/reviews
 * Client submits a rating for a COMPLETED service order.
 * One review per order (enforced by UNIQUE constraint on order_id).
 * Also manually recalculates services.rating + services.reviews_count
 * so it works even before the DB trigger migration is applied.
 */
exports.createServiceReview = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { order_id, rating, comment } = req.body;

        if (!order_id) return res.status(400).json({ success: false, message: 'order_id is required' });
        const ratingNum = Number(rating);
        if (!ratingNum || ratingNum < 1 || ratingNum > 5)
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });

        // Verify the order exists, belongs to this client, and is COMPLETED
        const { data: order, error: orderErr } = await adminClient
            .from('service_orders')
            .select('id, service_id, client_id, freelancer_id, status')
            .eq('id', order_id)
            .maybeSingle();

        if (orderErr || !order)
            return res.status(404).json({ success: false, message: 'Order not found' });
        if (order.client_id !== clientId)
            return res.status(403).json({ success: false, message: 'Not your order' });
        if (order.status !== 'COMPLETED')
            return res.status(400).json({ success: false, message: 'You can only review completed orders' });

        // Check for duplicate
        const { data: existing } = await adminClient
            .from('service_reviews')
            .select('id')
            .eq('order_id', order_id)
            .maybeSingle();

        if (existing)
            return res.status(409).json({ success: false, message: 'You have already reviewed this order' });

        // Insert review
        const { data: review, error } = await adminClient
            .from('service_reviews')
            .insert([{
                service_id: order.service_id,
                order_id,
                client_id: clientId,
                rating: ratingNum,
                comment: comment?.trim() || null,
            }])
            .select('id, service_id, order_id, rating, comment, created_at')
            .single();

        if (error) throw error;

        // Manually recalculate rating + reviews_count on the service row
        // (fallback in case the DB trigger hasn't been applied yet)
        const { data: allReviews } = await adminClient
            .from('service_reviews')
            .select('rating')
            .eq('service_id', order.service_id);

        if (allReviews && allReviews.length > 0) {
            const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
            await adminClient
                .from('services')
                .update({
                    rating: parseFloat(avg.toFixed(2)),
                    reviews_count: allReviews.length,
                })
                .eq('id', order.service_id)
                .catch(() => {}); // non-fatal if column doesn't exist yet
        }

        // Notify freelancer
        await adminClient.from('notifications').insert([{
            user_id: order.freelancer_id,
            title: 'New Service Review',
            content: `You received a ${ratingNum}-star review on your service`,
            type: 'CONTRACT_UPDATE',
        }]).catch(() => {});

        res.status(201).json({ success: true, data: review, message: 'Review submitted successfully' });
    } catch (err) {
        // If service_reviews table doesn't exist yet, give a clear message
        if (err.code === '42P01') {
            return res.status(503).json({
                success: false,
                message: 'Service reviews are not yet enabled. Please run the migration: backend/supabase/migrations/20260524_service_reviews.sql',
            });
        }
        next(err);
    }
};

/**
 * GET /api/services/:id/reviews
 * Public — fetch all reviews for a service with reviewer info and average.
 */
exports.getServiceReviews = async (req, res, next) => {
    try {
        const { id } = req.params;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
        const offset = (page - 1) * limit;

        const { data: reviews, error, count } = await adminClient
            .from('service_reviews')
            .select(`
                id, rating, comment, created_at,
                client:client_id ( user_id, name, avatar_url )
            `, { count: 'exact' })
            .eq('service_id', id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            // Table doesn't exist yet — return empty gracefully
            if (error.code === '42P01' || error.code === 'PGRST205') {
                return res.status(200).json({
                    success: true,
                    data: { reviews: [], average_rating: 0, total_reviews: 0 },
                    pagination: { page, limit, total: 0 },
                });
            }
            throw error;
        }

        // Get cached avg from services table
        const { data: service } = await adminClient
            .from('services')
            .select('rating, reviews_count')
            .eq('id', id)
            .maybeSingle();

        // Compute avg from reviews if service.rating not set
        let avgRating = service?.rating || 0;
        if (!avgRating && reviews && reviews.length > 0) {
            avgRating = parseFloat((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2));
        }

        res.status(200).json({
            success: true,
            data: {
                reviews: reviews || [],
                average_rating: avgRating,
                total_reviews: service?.reviews_count || count || 0,
            },
            pagination: { page, limit, total: count || 0 },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/services/orders/:order_id/review-status
 * Client checks if they've already reviewed a specific order.
 */
exports.getOrderReviewStatus = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { order_id } = req.params;

        const { data: review, error } = await adminClient
            .from('service_reviews')
            .select('id, rating, comment, created_at')
            .eq('order_id', order_id)
            .eq('client_id', clientId)
            .maybeSingle();

        // Table doesn't exist yet — treat as not reviewed
        if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
            return res.status(200).json({ success: true, data: { reviewed: false, review: null } });
        }
        if (error) throw error;

        res.status(200).json({ success: true, data: { reviewed: !!review, review: review || null } });
    } catch (err) {
        next(err);
    }
};
