const supabase = require('../supabase/client');
const logger = require('../utils/logger');

/**
 * FEATURE GATING MIDDLEWARE (MERN SaaS Level)
 * Enforces plan-based access and active membership status
 */
const requireFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            const userId = req.user.id;

            // 1. Fetch current active membership with snapshot
            const { data: membership, error } = await supabase
                .from('memberships')
                .select('*, plan_id(name)')
                .eq('user_id', userId)
                .eq('status', 'ACTIVE')
                .single();

            // 2. STRIKE 1: No active membership
            if (error || !membership) {
                return res.status(403).json({
                    success: false,
                    message: "Access Denied: You need an active membership plan to access this feature.",
                    code: "MEMBERSHIP_REQUIRED"
                });
            }

            // 3. STRIKE 2: Expiry Check (Safety)
            if (membership.end_date && new Date() > new Date(membership.end_date)) {
                // Background update status to EXPIRED
                supabase.from('memberships').update({ status: 'EXPIRED' }).eq('id', membership.id);
                return res.status(403).json({
                    success: false,
                    message: "Your membership has expired. Please upgrade.",
                    code: "MEMBERSHIP_EXPIRED"
                });
            }

            // 4. STRIKE 3: Feature Permission Check
            // Check in the snapshot first (Best practice for historical consistency)
            const snapshot = membership.plan_snapshot || {};
            const features = snapshot.features || [];

            // If feature is not in snapshot, check the current plan definition as fallback
            if (!features.includes(featureName)) {
                return res.status(403).json({
                    success: false,
                    message: `Upgrade Required: This action requires a plan that includes "${featureName}".`,
                    code: "FEATURE_NOT_IN_PLAN"
                });
            }

            // User passed all checks
            req.membership = membership; // Attach for downstream use
            next();

        } catch (error) {
            logger.error(`[Middleware] Feature Gating Error: ${featureName}`, error);
            res.status(500).json({ success: false, message: "Internal access verification error" });
        }
    };
};

module.exports = { requireFeature };
