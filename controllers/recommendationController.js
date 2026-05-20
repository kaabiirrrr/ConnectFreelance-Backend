const jobRecommendationService = require('../services/jobRecommendationService');
const logger = require('../utils/logger');

/**
 * GET /api/recommendations
 * Get AI-powered job recommendations for the logged-in freelancer.
 */
exports.getRecommendations = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const result = await jobRecommendationService.getRecommendations(freelancerId, { limit, offset });

        // If cold start, trigger background compute and return empty with indicator
        if (result.is_cold_start) {
            return res.status(200).json({
                success: true,
                data: [],
                total: 0,
                is_cold_start: true,
                message: 'Computing your personalized matches. Check back in a moment.'
            });
        }

        res.status(200).json({
            success: true,
            data: result.recommendations,
            total: result.total,
            is_cold_start: false
        });

    } catch (err) {
        logger.error('[RecommendationController] getRecommendations failed', err);
        next(err);
    }
};

/**
 * POST /api/recommendations/event
 * Track a behavioral signal (click, save, apply, dismiss, etc.)
 */
exports.trackEvent = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { job_id, event_type, metadata = {} } = req.body;

        const VALID_EVENTS = [
            'impression', 'click', 'save', 'apply',
            'dismiss', 'hide_job', 'not_relevant', 'dont_show_similar', 'hired'
        ];

        if (!job_id) return res.status(400).json({ success: false, message: 'job_id is required' });
        if (!VALID_EVENTS.includes(event_type)) {
            return res.status(400).json({ success: false, message: `Invalid event_type. Must be one of: ${VALID_EVENTS.join(', ')}` });
        }

        // Fire and forget — don't block the response
        jobRecommendationService.trackEvent(freelancerId, job_id, event_type, metadata).catch(() => {});

        res.status(200).json({ success: true, message: 'Event recorded' });

    } catch (err) {
        logger.error('[RecommendationController] trackEvent failed', err);
        next(err);
    }
};

/**
 * GET /api/recommendations/profile-ai-score
 * Get the AI profile readiness / completeness score.
 */
exports.getProfileAIScore = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const result = await jobRecommendationService.getProfileAIScore(freelancerId);

        if (!result) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }

        res.status(200).json({ success: true, data: result });

    } catch (err) {
        logger.error('[RecommendationController] getProfileAIScore failed', err);
        next(err);
    }
};

/**
 * POST /api/recommendations/compute
 * Admin-only: Trigger background compute for a specific freelancer.
 */
exports.triggerCompute = async (req, res, next) => {
    try {
        const { freelancer_id } = req.body;
        const targetId = freelancer_id || req.user.id;

        // Fire and forget
        jobRecommendationService.computeForFreelancer(targetId).catch(() => {});

        res.status(202).json({ success: true, message: 'Recommendation compute triggered in background.' });

    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/recommendations/connect-cost/:jobId
 * Get dynamic connect cost for a specific job based on match score.
 */
exports.getConnectCost = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { jobId } = req.params;
        const connectsService = require('../services/connectsService');

        const cost = await connectsService.getJobApplicationCost(jobId, freelancerId);

        res.status(200).json({ success: true, data: { connect_cost: cost, job_id: jobId } });

    } catch (err) {
        next(err);
    }
};
