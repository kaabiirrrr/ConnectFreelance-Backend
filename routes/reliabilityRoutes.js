const express = require('express');
const router = express.Router();
const adminClient = require('../supabase/adminClient');
const { calculateReliabilityScore } = require('../utils/reliabilityCalculator');
const { fetchReliabilityInsight } = require('../utils/aiInsightService');
const { getRiskAnalysis } = require('../utils/riskService');
const logger = require('../utils/logger');

/**
 * GET /api/freelancer/:id/reliability
 * Returns score, stats, trend, and AI insights.
 */
router.get('/:id/reliability', async (req, res) => {
    try {
        const freelancerId = req.params.id;

        // 1. Fetch current profile data (cached)
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('reliability_score, ai_insight, ai_last_updated')
            .eq('user_id', freelancerId)
            .single();

        if (profileError) throw profileError;

        const now = new Date();
        const lastUpdated = profile.ai_last_updated ? new Date(profile.ai_last_updated) : new Date(0);
        const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

        let finalData = {
            score: profile.reliability_score || 100,
            insight: profile.ai_insight,
            stats: null, // Basic stats not stored in profile, only in history or calculated
            isNew: false,
            trend: 0
        };

        // 2. Determine if we need to refresh (if cache > 12 hours)
        if (!profile.ai_insight || hoursSinceUpdate >= 12) {
            logger.log(`[ReliabilityRoute] Cache stale (${Math.round(hoursSinceUpdate)}h). Refreshing for ${freelancerId}`);
            
            const { score, stats, isNew } = await calculateReliabilityScore(freelancerId);
            const insight = await fetchReliabilityInsight(stats, '70b', 'freelancer');


            // Update profile with fresh data
            await adminClient
                .from('profiles')
                .update({
                    reliability_score: score,
                    ai_insight: insight,
                    ai_last_updated: now.toISOString()
                })
                .eq('user_id', freelancerId);

            finalData = { score, insight, stats, isNew };
        } else {
            // Even if using cached insight, we might want fresh stats for the UI
            // But to keep it <200ms, we only calculate stats if specifically requested or if refreshing AI
            // For now, let's calculate lightweight stats if missing
            const { score, stats, isNew } = await calculateReliabilityScore(freelancerId);
            finalData.stats = stats;
            finalData.isNew = isNew;
            finalData.score = score;
        }

        // 3. Calculate Trend (Compare with history from 7 days ago)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: history, error: historyError } = await adminClient
            .from('reliability_history')
            .select('score')
            .eq('freelancer_id', freelancerId)
            .lte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        if (!historyError && history && history.length > 0) {
            finalData.trend = finalData.score - history[0].score;
        }

        res.json({
            success: true,
            data: finalData
        });
    } catch (error) {
        logger.error('[ReliabilityRoute] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reliability data'
        });
    }
});
/**
 * GET /api/freelancer/:id/risk
 * Returns deterministic risk level, score, confidence, and AI assessment.
 */
router.get('/:id/risk', async (req, res) => {
    try {
        const freelancerId = req.params.id;
        const analysis = await getRiskAnalysis(freelancerId);

        res.json({
            success: true,
            data: analysis
        });
    } catch (error) {
        logger.error('[RiskRoute] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch risk analysis'
        });
    }
});


module.exports = router;
