const adminClient = require('../supabase/adminClient');
const { calculateReliabilityScore } = require('./reliabilityCalculator');
const { predictRisk } = require('./riskPredictor');
const { getAiRiskInsight } = require('./riskAiService');
const logger = require('./logger');

/**
 * High-level service to orchestrate Risk Analysis.
 */
const getRiskAnalysis = async (freelancerId) => {
    try {
        const now = new Date();

        // 1. Fetch profile state
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('reliability_score, risk_analysis, risk_last_updated')
            .eq('user_id', freelancerId)
            .single();

        if (profileError) throw profileError;

        const lastUpdated = profile.risk_last_updated ? new Date(profile.risk_last_updated) : new Date(0);
        const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);
        const isStale = !profile.risk_analysis || hoursSinceUpdate >= 12;

        // 2. PARALLEL FETCH OPTIMIZATION for raw data
        const { score, stats, isNew } = await calculateReliabilityScore(freelancerId);
        const riskData = predictRisk(score, stats);

        // 3. RETURN INSTANTLY IF NOT STALE
        if (!isStale) {
            return {
                ...riskData,
                stats: { score, ...stats },
                insight: profile.risk_analysis
            };
        }

        // 4. STALE DATA: Trigger AI in background, return deterministic risk immediately
        // We return the old insight (or a preliminary one) while the new one is cooked
        const responseData = {
            ...riskData,
            stats: { score, ...stats },
            insight: profile.risk_analysis || {
                summary: "Analysis in progress...",
                suggestion: "Reviewing latest behavioral patterns.",
                isPreliminary: true
            }
        };

        // BACKGROUND UPDATE: NO await here
        logger.log(`[RiskService] Triggering Background AI Risk Update for ${freelancerId}`);
        getAiRiskInsight(
            { ...stats, score, confidence: riskData.confidence },
            riskData.riskLevel,
            riskData.riskScore
        ).then(async (newInsight) => {
            const { error: updateError } = await adminClient
                .from('profiles')
                .update({
                    risk_analysis: newInsight,
                    risk_last_updated: now.toISOString()
                })
                .eq('user_id', freelancerId);

            if (updateError) logger.error('[RiskService] Background Update Failed:', updateError);
            else logger.log(`[RiskService] Successfully updated AI insight for ${freelancerId}`);
        }).catch(err => {
            logger.error('[RiskService] Background AI Logic Error:', err);
        });

        return responseData;

    } catch (error) {
        logger.error('[RiskService] Orchestration Error:', error);
        throw error;
    }
};

module.exports = { getRiskAnalysis };
