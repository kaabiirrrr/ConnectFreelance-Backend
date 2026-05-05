const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * Reputation Shield - Global JSS-like Scoring Service
 * Calculates a weighted, hidden trust score for every user.
 */
class ReputationService {
    /**
     * Recalculate global trust score for a user
     */
    static async recalculateScore(userId) {
        try {
            logger.info(`[ReputationService] Recalculating score for user: ${userId}`);

            // 1. Fetch performance data
            const { data: profile } = await adminClient
                .from('profiles')
                .select('role, rating, reviews_count, job_success_score, reliability_score')
                .eq('user_id', userId)
                .single();

            const { data: contracts } = await adminClient
                .from('contracts')
                .select('id, status, agreed_rate, created_at')
                .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`);

            const { count: disputeCount } = await adminClient
                .from('disputes')
                .select('*', { count: 'exact', head: true })
                .eq('raised_by', userId);

            const { count: bypassCount } = await adminClient
                .from('bypass_attempts')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            // 2. Weights & Components
            let score = 50; // Starting baseline
            const breakdown = {
                baseline: 50,
                volumeBonus: 0,
                successBonus: 0,
                valueBonus: 0,
                penaltyDisputes: 0,
                penaltyViolations: 0,
                decayPenalty: 0
            };

            // A. Volume & Tenure
            const totalContracts = contracts?.length || 0;
            breakdown.volumeBonus = Math.min(15, Math.floor(totalContracts / 2));
            score += breakdown.volumeBonus;

            // B. Success Rate (Weighted by Recency)
            const completed = contracts?.filter(c => c.status === 'COMPLETED') || [];
            const successRate = totalContracts > 0 ? (completed.length / totalContracts) : 0.5;
            breakdown.successBonus = Math.round((successRate - 0.5) * 40); // Max +20, Max -20
            score += breakdown.successBonus;

            // C. High Value Client/Project Bonus
            const highValueContracts = completed.filter(c => Number(c.agreed_rate) > 500);
            breakdown.valueBonus = Math.min(10, highValueContracts.length * 2);
            score += breakdown.valueBonus;

            // D. Penalties
            breakdown.penaltyDisputes = (disputeCount || 0) * -10;
            breakdown.penaltyViolations = (bypassCount || 0) * -15;
            score += breakdown.penaltyDisputes;
            score += breakdown.penaltyViolations;

            // E. Profile Health (Legacy Sync)
            if (profile?.job_success_score < 80) {
                score -= 10;
            }

            // Clamp final score
            const finalScore = Math.max(0, Math.min(100, score));

            // 3. Persist to profile
            await adminClient
                .from('profiles')
                .update({
                    internal_trust_score: finalScore,
                    trust_score_breakdown: breakdown,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId);

            logger.info(`[ReputationService] User ${userId} score updated to: ${finalScore}`);
            return finalScore;

        } catch (err) {
            logger.error('[ReputationService] Score calculation failed', err);
            return null;
        }
    }

    /**
     * Batch update scores for active users (Cron job potential)
     */
    static async batchUpdate() {
        // Logic to find active users in last 30 days and update them
    }
}

module.exports = ReputationService;
