const { calculateReliabilityScore } = require('./reliabilityCalculator');
const adminClient = require('../supabase/adminClient');
const logger = require('./logger');
const { triggerInterventionCheck } = require('./interventionService');

/**
 * Trigger an asynchronous reliability score update for a freelancer.
 * Updates the profile but does not record history (cron handles history).
 * 
 * @param {string} freelancerId - The user_id of the freelancer
 */
const triggerReliabilityUpdate = async (freelancerId) => {
    // We run this in the background to keep the main API response fast
    setImmediate(async () => {
        try {
            const { score } = await calculateReliabilityScore(freelancerId);
            
            const { error } = await adminClient
                .from('profiles')
                .update({ 
                    reliability_score: score 
                })
                .eq('user_id', freelancerId);

            if (error) throw error;
            
            logger.log(`[ReliabilityService] Background update success for ${freelancerId}. New Score: ${score}`);

            // NEW: Trigger the Autonomous Intervention System check
            triggerInterventionCheck(freelancerId);
            
        } catch (error) {
            logger.error(`[ReliabilityService] Background update failed for ${freelancerId}:`, error.message);
        }
    });
};

module.exports = { triggerReliabilityUpdate };
