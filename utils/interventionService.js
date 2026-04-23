const adminClient = require('../supabase/adminClient');
const logger = require('./logger');
const { runRules, shouldAutoResolve, STATUS, INTERVENTION_TYPES } = require('./interventionEngine');
const { getRiskAnalysis } = require('./riskService');
const { getContractDeadlineRisk } = require('./deadlinePredictor');
const notificationService = require('../services/notificationService');

// In-memory debounce tracker
const debounceCache = new Map();

/**
 * Main orchestration service for autonomous interventions.
 */
const triggerInterventionCheck = async (freelancerId) => {
    // 1. Debounce Logic: 10 second window to prevent DB pressure during rapid work_log updates
    const now = Date.now();
    if (debounceCache.has(freelancerId)) {
        const lastRun = debounceCache.get(freelancerId);
        if (now - lastRun < 10000) return; 
    }
    debounceCache.set(freelancerId, now);

    // Run in background to keep API fast
    setImmediate(async () => {
        try {
            logger.log(`[InterventionService] Starting check for freelancer: ${freelancerId}`);

            // 2. Fetch Active Contracts for this freelancer
            const { data: contracts, error: contractError } = await adminClient
                .from('contracts')
                .select('id, job_id, freelancer_id, end_date')
                .eq('freelancer_id', freelancerId)
                .in('status', ['ACTIVE', 'IN_PROGRESS']);

            if (contractError) throw contractError;
            if (!contracts || contracts.length === 0) return;

            for (const contract of contracts) {
                // 3. Gather Context from Risk and Deadline services
                const risk = await getRiskAnalysis(freelancerId);
                const deadline = await getContractDeadlineRisk(contract.id);

                // Fetch latest work log date for the "idle" check
                const { data: lastLog } = await adminClient
                    .from('work_logs')
                    .select('date')
                    .eq('job_id', contract.job_id)
                    .order('date', { ascending: false })
                    .limit(1)
                    .single();

                const context = {
                    riskScore: risk.riskScore,
                    deadlineProbability: deadline.failure_probability,
                    lastLogDate: lastLog?.date,
                    isHighRisk: risk.riskLevel === 'high'
                };

                // 4. Run Auto-Resolution Logic
                if (shouldAutoResolve(context.riskScore, context.deadlineProbability)) {
                    await handleAutoResolution(contract.id);
                }

                // 5. Run Intervention Rules
                const triggers = runRules(context);

                // 🧠 PRIORITY QUEUE: Sort high -> medium -> low
                const priorityWeight = { high: 3, medium: 2, low: 1 };
                triggers.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);

                for (const trigger of triggers) {
                    // 🔒 RATE LIMIT GLOBAL: Max 5 interventions per job per 24h
                    const { count: dayCount } = await adminClient
                        .from('interventions')
                        .select('id', { count: 'exact', head: true })
                        .eq('job_id', contract.job_id)
                        .gt('created_at', new Date(Date.now() - 86400000).toISOString());

                    if (dayCount >= 5) {
                        logger.warn(`[InterventionService] Rate limit hit for job ${contract.job_id}. Skipping trigger ${trigger.type}.`);
                        continue;
                    }

                    await processTrigger(contract, trigger, context);
                }
            }
        } catch (error) {
            logger.error(`[InterventionService] Error:`, error.message);
        }
    });
};

/**
 * Processes a single trigger: Check cooldown (DB level) and trigger notifications.
 */
const processTrigger = async (contract, trigger, context) => {
    try {
        // Special logic for Level 3 persistence check (24h)
        if (trigger.type === INTERVENTION_TYPES.ESCALATION) {
            const isPersistent = await checkEscalationPersistence(contract.id);
            if (!isPersistent) return;
        }

        // Insert into DB - The DB Trigger 'trg_intervention_cooldown' handles the 12h cooldown
        const { data: intervention, error } = await adminClient
            .from('interventions')
            .insert([{
                job_id: contract.job_id,
                contract_id: contract.id,
                freelancer_id: contract.freelancer_id,
                type: trigger.type,
                priority: trigger.priority,
                status: STATUS.ACTIVE, // Start as ACTIVE directly for automation
                metadata: {
                    ...context,
                    reason: trigger.reason
                }
            }])
            .select()
            .single();

        if (error) {
            // If it's a cooldown violation, the DB will error with our custom message
            if (error.message.includes('cooldown')) {
                // logger.debug(`[InterventionService] Cooldown in effect for ${trigger.type} on contract ${contract.id}`);
                return;
            }
            throw error;
        }

        // 6. Send Notification via NotificationService
        await notificationService.sendInterventionNotification(intervention, trigger.message);

        logger.log(`[InterventionService] Successfully triggered ${trigger.type} for contract ${contract.id}`);

    } catch (err) {
        logger.error('[InterventionService] Trigger Processing Error:', err.message);
    }
};

/**
 * Marks all ACTIVE interventions for a contract as RESOLVED.
 */
const handleAutoResolution = async (contractId) => {
    const { data: activeInterventions } = await adminClient
        .from('interventions')
        .select('id')
        .eq('contract_id', contractId)
        .eq('status', STATUS.ACTIVE);

    if (activeInterventions?.length > 0) {
        await adminClient
            .from('interventions')
            .update({ 
                status: STATUS.RESOLVED, 
                updated_at: new Date().toISOString(),
                resolved_at: new Date().toISOString()
            })
            .in('id', activeInterventions.map(i => i.id));
        
        logger.log(`[InterventionService] Auto-Resolved ${activeInterventions.length} interventions for contract ${contractId}`);
    }
};

/**
 * Checks if the condition for Level 3 escalation has persisted for 24 hours.
 */
const checkEscalationPersistence = async (contractId) => {
    // Logic: If there was a Triggered warning for Risk more than 24h ago, we allow escalation
    const { data: recentWarning } = await adminClient
        .from('interventions')
        .select('created_at')
        .eq('contract_id', contractId)
        .eq('type', INTERVENTION_TYPES.WARNING)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (!recentWarning) return false;

    const hoursSinceInitialWarning = (new Date() - new Date(recentWarning.created_at)) / (1000 * 60 * 60);
    return hoursSinceInitialWarning >= 24;
};

module.exports = { triggerInterventionCheck };
