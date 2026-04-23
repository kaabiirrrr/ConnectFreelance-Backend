const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { getIO } = require('../socket/index');

/**
 * Alerting Engine for Skimmer Co-Pilot
 * Handles prioritized alerts, 6h cooldown suppression, and real-time socket delivery.
 */

const COOLDOWN_HOURS = 6;
const socketThrottleMap = new Map(); // jobId -> lastEmitTime

/**
 * Core alert processing logic
 */
const triggerAlert = async (jobId, type, priority, message, metadata = {}) => {
    try {
        // 1. Cooldown Check (6h suppression)
        const cooldownStart = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
        const { data: existingAlert } = await adminClient
            .from('project_activity_log')
            .select('id')
            .eq('job_id', jobId)
            .eq('type', type)
            .gt('created_at', cooldownStart)
            .limit(1)
            .maybeSingle();

        if (existingAlert) {
            return { success: false, message: 'Alert suppressed by cooldown.' };
        }

        // 2. Store in Activity Log
        const { data: logEntry, error } = await adminClient
            .from('project_activity_log')
            .insert([{
                job_id: jobId,
                type,
                priority,
                metadata: { ...metadata, message },
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) throw error;

        // 3. Socket Throttling (5s)
        const now = Date.now();
        const lastEmit = socketThrottleMap.get(jobId) || 0;
        if (now - lastEmit > 5000) {
            socketThrottleMap.set(jobId, now);
            const io = getIO();
            io.to(`conv:${jobId}`).emit('project_alert', {
                jobId,
                type,
                priority,
                message,
                created_at: logEntry.created_at
            });
            io.emit('project_alert_global', { jobId, priority, message }); 
        }

        logger.info(`[SkimmerAlerts] Triggered ${priority} Alert: ${message} (Job: ${jobId})`);
        return { success: true, alert: logEntry };

    } catch (err) {
        logger.error('[SkimmerAlerts] triggerAlert failed', err);
        return { success: false, error: err.message };
    }
};

/**
 * Automated Rule Checks
 */
const checkProjectAlerts = async (jobId, metrics) => {
    const alertsTriggered = [];

    // 1. Health Critical Alert (<40)
    if (metrics.health_score < 40) {
        const res = await triggerAlert(jobId, 'low_health', 'HIGH', 'Project health reached critical levels (<40). Immediate intervention required.');
        if (res.success) alertsTriggered.push(res.alert);
    }

    // 2. High Risk Alert (>60)
    if (metrics.deadlineProb > 0.6 || (metrics.riskScore > 60)) {
        const res = await triggerAlert(jobId, 'high_risk', 'MEDIUM', 'Project has exceeded the safe risk threshold. Review timeline and resources.');
        if (res.success) alertsTriggered.push(res.alert);
    }

    // 3. Inactivity Alert (Checked separately via Cron or Logic)
    if (metrics.activityScore < 30) {
        const res = await triggerAlert(jobId, 'inactivity', 'HIGH', 'Significant inactivity detected (36h+). Team engagement is dropping.');
        if (res.success) alertsTriggered.push(res.alert);
    }

    return alertsTriggered;
};

module.exports = {
    triggerAlert,
    checkProjectAlerts
};
