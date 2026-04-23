const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { recalculateProjectHealth } = require('../services/skimmerEngine');
const { generateProjectAdvice } = require('../services/skimmerAIService');

/**
 * Skimmer Co-Pilot Cron / Batch Runner
 * Handles 6-hour periodic updates and safe retroactive analysis.
 */

const BATCH_SIZE = 25;
const BATCH_DELAY = 2000; // 2s

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs a full health scan for all active job contracts
 */
const runFullHealthAudit = async () => {
    logger.info('[SkimmerCron] Starting Full Health Audit...');
    
    try {
        // 1. Fetch all active job IDs from active contracts
        const { data: activeContractJobs, error } = await adminClient
            .from('contracts')
            .select('job_id')
            .eq('status', 'ACTIVE');

        if (error) throw error;

        // Dedup job IDs
        const jobIds = [...new Set(activeContractJobs.map(c => c.job_id))];
        logger.info(`[SkimmerCron] Found ${jobIds.length} active jobs to audit.`);

        // 2. Process in Batches
        for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
            const batch = jobIds.slice(i, i + BATCH_SIZE);
            logger.log(`[SkimmerCron] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} jobs)...`);

            await Promise.all(batch.map(async (jobId) => {
                try {
                    const res = await recalculateProjectHealth(jobId);
                    if (res.health_score < 60) {
                        await generateProjectAdvice(jobId, res.metrics || { health_score: res.health_score });
                    }
                } catch (err) {
                    logger.error(`[SkimmerCron] Failed to audit job ${jobId}`, err);
                }
            }));

            if (i + BATCH_SIZE < jobIds.length) {
                await sleep(BATCH_DELAY);
            }
        }

        await calculateInvestorMetrics();
        logger.info('[SkimmerCron] Audit completed successfully.');

    } catch (err) {
        logger.error('[SkimmerCron] Audit failed', err);
    }
};

/**
 * Aggregates high-level metrics for investors
 */
const calculateInvestorMetrics = async () => {
    try {
        const { data: insights } = await adminClient.from('project_insights').select('health_score, delay_risk, team_efficiency');
        if (!insights || insights.length === 0) return;

        const total = insights.length;
        const avgHealth = insights.reduce((sum, i) => sum + i.health_score, 0) / total;
        const successRate = insights.filter(i => i.health_score > 70).length / total;
        const recoveryRate = insights.filter(i => i.health_score > 50 && i.health_score < 75).length / total;

        logger.info('[SkimmerCron] Global Investor Metrics Computed', {
            avgHealth: avgHealth.toFixed(1),
            successRate: (successRate * 100).toFixed(1) + '%',
            recoveryRate: (recoveryRate * 100).toFixed(1) + '%'
        });
    } catch (err) {
        logger.error('[SkimmerCron] Investor metrics failed', err);
    }
};

module.exports = {
    runFullHealthAudit
};
