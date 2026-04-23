const cron = require('node-cron');
const adminClient = require('../supabase/adminClient');
const { calculateReliabilityScore } = require('../utils/reliabilityCalculator');
const logger = require('../utils/logger');

/**
 * Daily Cron Task: Updates reliability scores for all active freelancers
 * and records history for trend analysis.
 * Processes in batches of 100 to prevent DB spikes.
 */
const runReliabilityCron = async () => {
    logger.log('[ReliabilityCron] Starting daily trust engine update...');
    
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let processedCount = 0;

    try {
        while (hasMore) {
            // Fetch batch of unique freelancer IDs with at least one ACTIVE contract
            // Using a subquery-like approach via 'select' for efficiency
            const { data: contracts, error } = await adminClient
                .from('contracts')
                .select('freelancer_id')
                .eq('status', 'ACTIVE')
                .range(offset, offset + limit - 1);

            if (error) {
                logger.error('[ReliabilityCron] DB Fetch Error:', error);
                break;
            }

            if (!contracts || contracts.length === 0) {
                hasMore = false;
                break;
            }

            // Extract unique freelancer IDs in this batch
            const freelancerIds = [...new Set(contracts.map(c => c.freelancer_id))];

            for (const freelancerId of freelancerIds) {
                try {
                    // 1. Calculate fresh score
                    const { score } = await calculateReliabilityScore(freelancerId);

                    // 2. Update profiles table
                    const { error: updateError } = await adminClient
                        .from('profiles')
                        .update({ reliability_score: score })
                        .eq('user_id', freelancerId);

                    if (updateError) throw updateError;

                    // 3. Record in history for trends
                    const { error: historyError } = await adminClient
                        .from('reliability_history')
                        .insert({
                            freelancer_id: freelancerId,
                            score: score
                        });

                    if (historyError) throw historyError;

                    processedCount++;
                } catch (userError) {
                    logger.error(`[ReliabilityCron] Error for user ${freelancerId}:`, userError.message);
                }
            }

            offset += limit;
            if (contracts.length < limit) hasMore = false;
        }

        logger.log(`[ReliabilityCron] Successfully updated ${processedCount} freelancers.`);
    } catch (globalError) {
        logger.error('[ReliabilityCron] Critical process failure:', globalError);
    }
};

/**
 * Note: Scheduled in server.js to maintain centralized lifecycle control.
 */
module.exports = { runReliabilityCron };
