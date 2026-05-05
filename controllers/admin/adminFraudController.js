const adminClient = require('../../supabase/adminClient');
const TrustGraphService = require('../../services/TrustGraphService');
const ReputationService = require('../../services/ReputationService');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

/**
 * Get all fraud clusters detected by the Link Detection Engine
 */
exports.getClusters = async (req, res, next) => {
    try {
        const clusters = await TrustGraphService.discoverClusters();
        
        // Enrich clusters with user profiles
        const enrichedClusters = await Promise.all(clusters.map(async (cluster) => {
            const { data: profiles, error } = await adminClient
                .from('profiles')
                .select('user_id, name, email, avatar_url, trust_score, fraud_flag')
                .in('user_id', cluster.userIds);
            
            if (error) throw error;
            
            return {
                ...cluster,
                users: profiles || []
            };
        }));

        res.status(200).json({
            success: true,
            data: enrichedClusters
        });
    } catch (error) {
        logger.error('[AdminFraud] Failed to fetch clusters', error);
        next(error);
    }
};

/**
 * Recalculate trust score for a specific user
 */
exports.recalculateUserScore = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const newScore = await ReputationService.recalculateScore(userId);
        
        await logAction(req.user.id, 'REPUTATION_RECALCULATE', userId, `Recalculated trust score for user ${userId}. New score: ${newScore}`);

        res.status(200).json({
            success: true,
            data: { trust_score: newScore },
            message: 'Trust score recalculated successfully'
        });
    } catch (error) {
        logger.error('[AdminFraud] Failed to recalculate score', error);
        next(error);
    }
};

/**
 * Mark a user as a fraud (sets fraud_flag and updates Reputation Shield)
 */
exports.flagUserAsFraud = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;

        const { error } = await adminClient
            .from('profiles')
            .update({ fraud_flag: true })
            .eq('user_id', userId);

        if (error) throw error;

        // Force score recalculation (will be penalized due to fraud_flag)
        await ReputationService.recalculateScore(userId);

        await logAction(req.user.id, 'USER_FLAG_FRAUD', userId, `Flagged user ${userId} as fraud. Reason: ${reason || 'Not specified'}`);

        res.status(200).json({
            success: true,
            message: 'User flagged as fraud'
        });
    } catch (error) {
        logger.error('[AdminFraud] Failed to flag user', error);
        next(error);
    }
};
