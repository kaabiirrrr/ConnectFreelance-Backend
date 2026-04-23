/**
 * Intervention Engine
 * Dedicated logic for autonomous project management triggers and state management.
 */

const INTERVENTION_TYPES = {
    WARNING: 'warning',
    CLIENT_ALERT: 'client_alert',
    ESCALATION: 'escalation'
};

const STATUS = {
    TRIGGERED: 'TRIGGERED',
    ACTIVE: 'ACTIVE',
    RESOLVED: 'RESOLVED'
};

const PRIORITY = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
};

/**
 * Ruleset for triggering interventions based on behavior and timeline risks.
 */
const runRules = (context) => {
    const { riskScore, deadlineProbability, lastLogDate, isHighRisk } = context;
    const triggers = [];

    // 1. Level 1: Behavioral Warning
    if (riskScore > 60) {
        triggers.push({
            type: INTERVENTION_TYPES.WARNING,
            priority: PRIORITY.LOW,
            reason: "risk_threshold_crossed",
            message: "Project risk is increasing. Please update your progress and maintain consistent activity."
        });
    }

    // 2. Level 2: Deadline/Client Alert
    if (deadlineProbability > 65) {
        triggers.push({
            type: INTERVENTION_TYPES.CLIENT_ALERT,
            priority: PRIORITY.MEDIUM,
            reason: "deadline_probability_high",
            message: "This project shows signs of potential delay based on current performance trends."
        });
    }

    // 3. Level 3: Extreme Escalation (48h Idle + High Risk)
    const hoursSinceLastLog = lastLogDate ? (new Date() - new Date(lastLogDate)) / (1000 * 60 * 60) : 999;
    if (hoursSinceLastLog > 48 && isHighRisk) {
        triggers.push({
            type: INTERVENTION_TYPES.ESCALATION,
            priority: PRIORITY.HIGH,
            reason: "inactivity_high_risk",
            message: "No activity detected for 48+ hours combined with high failure probability. Escalation required."
        });
    }

    return triggers;
};

/**
 * Logic to check if an active intervention should be automatically resolved.
 */
const shouldAutoResolve = (riskScore, deadlineProbability) => {
    // If both metrics fall below 40%, the situation is considered stable
    return riskScore < 40 && deadlineProbability < 40;
};

module.exports = { runRules, shouldAutoResolve, INTERVENTION_TYPES, STATUS, PRIORITY };
