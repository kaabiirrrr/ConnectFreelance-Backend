const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { getJobDeadlineRisk } = require('./deadlineRiskService');

/**
 * Core Engine for Skimmer Co-Pilot
 * Calculates Health Scores, Smart Activity, and Trend Deltas.
 */

const DEBOUNCE_TIME = 10000; // 10s
const FREEZE_WINDOW = 60000; // 60s
const updateCache = new Map(); // jobId -> lastUpdateTime

/**
 * Smart Activity Score Calculation
 * activity_score = 0.5 * log_consistency + 0.3 * recency_score + 0.2 * responsiveness
 */
const calculateSmartActivity = async (jobId, freelancerId) => {
    try {
        // 1. Log Consistency (Last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count: actualLogs } = await adminClient
            .from('work_logs')
            .select('id', { count: 'exact', head: true })
            .eq('job_id', jobId)
            .eq('user_id', freelancerId)
            .gt('created_at', sevenDaysAgo);

        // Expected logs: roughly 5 logs per week for consistency
        const expectedLogs = 5; 
        const logConsistency = Math.min((actualLogs / expectedLogs) * 100, 100);

        // 2. Recency Score
        const { data: lastLog } = await adminClient
            .from('work_logs')
            .select('created_at')
            .eq('job_id', jobId)
            .eq('user_id', freelancerId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        let recencyScore = 20; // Default: >48h
        if (lastLog) {
            const hoursSince = (Date.now() - new Date(lastLog.created_at)) / (1000 * 60 * 60);
            if (hoursSince < 24) recencyScore = 100;
            else if (hoursSince < 48) recencyScore = 60;
        }

        // 3. Responsiveness (v2 simplified: interaction count in last 48h)
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { count: interactionCount } = await adminClient
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('sender_id', freelancerId)
            .gt('created_at', fortyEightHoursAgo);

        const responsiveness = Math.min((interactionCount / 4) * 100, 100); // 4 msgs = 100%

        return (0.5 * logConsistency) + (0.3 * recencyScore) + (0.2 * responsiveness);
    } catch (err) {
        logger.error('[SkimmerEngine] calculateSmartActivity failed', err);
        return 50;
    }
};

/**
 * Main Recalculation Loop
 */
const recalculateProjectHealth = async (jobId) => {
    const now = Date.now();
    const lastUpdate = updateCache.get(jobId) || 0;

    // 10s Debounce + 60s Freeze Window
    if (now - lastUpdate < FREEZE_WINDOW) {
        return { success: true, message: 'Within freeze window, skipping update.' };
    }

    try {
        updateCache.set(jobId, now);

        // 1. Fetch Job and Contract Data
        const { data: contract } = await adminClient
            .from('contracts')
            .select('id, freelancer_id, client_id, status')
            .eq('job_id', jobId)
            .eq('status', 'ACTIVE')
            .maybeSingle();

        if (!contract) return { success: false, message: 'No active contract' };

        const freelancerId = contract.freelancer_id;

        // 2. Fetch Reliability & Risk (Existing Systems)
        const { data: profile } = await adminClient
            .from('profiles')
            .select('reliability_score')
            .eq('user_id', freelancerId)
            .maybeSingle();
        
        const reliability = profile?.reliability_score || 100;
        
        // Deadline Risk Probability
        const deadlineProbResult = await getJobDeadlineRisk(jobId);
        const deadlineProb = deadlineProbResult.success ? deadlineProbResult.data.probability : 0;
        const riskScore = deadlineProbResult.success ? deadlineProbResult.data.factors.risk_score : 0;

        // 3. Completion Rate (Weighted Tasks)
        const { data: tasks } = await adminClient
            .from('project_tasks')
            .select('status, weight')
            .eq('job_id', jobId)
            .eq('is_active', true);

        let completionRate = 0;
        if (tasks && tasks.length > 0) {
            const totalWeight = tasks.reduce((sum, t) => sum + (t.weight || 1), 0);
            const completedWeight = tasks
                .filter(t => t.status === 'completed')
                .reduce((sum, t) => sum + (t.weight || 1), 0);
            completionRate = (completedWeight / totalWeight) * 100;
        }

        // 4. Smart Activity Score
        const activityScore = await calculateSmartActivity(jobId, freelancerId);

        // 5. FINAL HEALTH FORMULA
        const healthScore = Math.round(
            (0.25 * reliability) +
            (0.25 * (100 - riskScore)) +
            (0.20 * (100 - deadlineProb)) +
            (0.20 * completionRate) +
            (0.10 * activityScore)
        );

        const clampedHealth = Math.max(0, Math.min(100, healthScore));

        // 6. Trend Analysis (24h Delta)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: pastHistory } = await adminClient
            .from('project_health_history')
            .select('health_score')
            .eq('job_id', jobId)
            .lt('created_at', twentyFourHoursAgo)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const previousScore = pastHistory?.health_score || clampedHealth;
        const delta = clampedHealth - previousScore;

        // 7. Store Results
        await adminClient.from('project_insights').upsert({
            job_id: jobId,
            health_score: clampedHealth,
            success_probability: clampedHealth / 100,
            delay_risk: deadlineProb,
            team_efficiency: completionRate / 100,
            last_updated: new Date().toISOString()
        }, { onConflict: 'job_id' });

        await adminClient.from('project_health_history').insert({
            job_id: jobId,
            health_score: clampedHealth,
            change_value: delta
        });

        logger.info(`[SkimmerEngine] Recalculated Health for Job ${jobId}: ${clampedHealth} (Delta: ${delta})`);

        return { 
            success: true, 
            health_score: clampedHealth, 
            delta, 
            metrics: { reliability, riskScore, deadlineProb, completionRate, activityScore }
        };

    } catch (err) {
        logger.error('[SkimmerEngine] Update failed', err);
        return { success: false, error: err.message };
    }
};

module.exports = {
    recalculateProjectHealth
};
