const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { INTERVENTION_TYPES } = require('../utils/interventionEngine');

/**
 * Standardized Notification Service
 */
const sendNotification = async (userId, title, content, type, link = null) => {
    try {
        const { data, error } = await adminClient
            .from('notifications')
            .insert([{
                user_id: userId,
                title,
                content,
                type,
                link,
                is_read: false,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        logger.error(`[NotificationService] Error:`, error.message);
        return null;
    }
};

/**
 * Helper: Retry mechanism for critical calls
 */
const sendWithRetry = async (fn, maxRetries = 3, delay = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            logger.warn(`[Retry] Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
    throw lastError;
};

/**
 * Specifically handles notifications for autonomous interventions.
 */
const sendInterventionNotification = async (intervention, message) => {
    const { type, freelancer_id, job_id, contract_id } = intervention;
    
    // Retry logic is crucial for autonomous systems
    try {
        await sendWithRetry(async () => {
            // 1. Notify Freelancer
            await sendNotification(
                freelancer_id,
                "Project Update Required",
                message,
                'intervention',
                `/freelancer/contracts/${contract_id}`
            );

            // 2. If it's a Client Alert or Escalation, notify the Client too
            if (type === INTERVENTION_TYPES.CLIENT_ALERT || type === INTERVENTION_TYPES.ESCALATION) {
                // Fetch client_id from jobs
                const { data: job } = await adminClient
                    .from('jobs')
                    .select('client_id')
                    .eq('id', job_id)
                    .single();

                if (job?.client_id) {
                    await sendNotification(
                        job.client_id,
                        "Project Monitoring Alert",
                        `System check: ${message}`,
                        'intervention_alert',
                        `/client/contracts/${contract_id}`
                    );
                }
            }
        });

        logger.log(`[NotificationService] Intervention notification sent for ${type}`);
    } catch (err) {
        logger.error(`[NotificationService] Critical failure after retries for ${type}:`, err.message);
    }
};

module.exports = { sendNotification, sendInterventionNotification };
