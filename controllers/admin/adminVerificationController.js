const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

/**
 * Get all verification requests
 */
exports.getVerificationRequests = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('profiles')
            .select(`
                user_id,
                name,
                email,
                verification_status,
                verification_documents,
                created_at
            `, { count: 'exact' })
            .neq('verification_status', 'NOT_SUBMITTED');

        if (status) query = query.eq('verification_status', status);

        const { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update freelancer verification status
 */
exports.updateVerificationStatus = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { status, message } = req.body; // status: APPROVED, REJECTED, RE_UPLOAD_REQUESTED

        const updateData = {
            verification_status: status,
            updated_at: new Date()
        };

        if (status === 'APPROVED') {
            updateData.is_verified = true;
            updateData.verified_at = new Date();
        } else {
            updateData.is_verified = false;
        }

        const { error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('user_id', userId);

        if (error) throw error;

        // Log action
        await logAction(
            req.user.id,
            'VERIFICATION_UPDATE',
            userId,
            `Verification ${status} for user ${userId}. ${message || ''}`
        );

        // Notify user (Implementation depends on notification system)
        // Send email or platform notification...

        res.status(200).json({
            success: true,
            message: `Verification status updated to ${status}`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Promote/Demote Featured Freelancer
 */
exports.toggleFeaturedStatus = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { isFeatured, expiryDate } = req.body;

        const { error } = await supabase
            .from('profiles')
            .update({
                is_featured: isFeatured,
                featured_until: isFeatured ? expiryDate : null
            })
            .eq('user_id', userId);

        if (error) throw error;

        await logAction(
            req.user.id,
            'FEATURED_TOGGLE',
            userId,
            `Freelancer ${userId} featured status set to ${isFeatured}`
        );

        res.status(200).json({
            success: true,
            message: `Freelancer featured status updated`
        });
    } catch (error) {
        next(error);
    }
};
