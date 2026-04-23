/**
 * Risk Predictor System
 * Calculates deterministic project failure risk based on behavioral metrics.
 */

const CLASSIFICATION = {
    UNDETERMINED: 'undetermined',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
};

const LABELS = {
    [CLASSIFICATION.UNDETERMINED]: 'New Freelancer',
    [CLASSIFICATION.LOW]: 'Reliable',
    [CLASSIFICATION.MEDIUM]: 'Moderate Risk',
    [CLASSIFICATION.HIGH]: 'May Need Attention'
};

/**
 * Calculates weighted risk score and confidence.
 * 
 * Formula:
 * risk_score = (100 - reliability_score) * 0.6 + (missed_days * 5) * 0.3 + (queries * 3) * 0.1
 * 
 * Confidence:
 * confidence = min(1, (logs / 30) * 0.5 + (active_days / 30) * 0.3 + (1 - missed / 30) * 0.2)
 * 
 * @param {number} reliabilityScore - Current 0-100 score
 * @param {Object} stats - { logs, missed, queries, expected }
 * @returns {Object} - { riskScore, riskLevel, label, confidence, isNew, isPreliminary }
 */
const predictRisk = (reliabilityScore, stats) => {
    const { logs, missed, queries, expected } = stats;

    // 1. Zero-Data Safety (New Freelancer Handling)
    if (logs === 0) {
        return {
            riskScore: 0,
            riskLevel: CLASSIFICATION.UNDETERMINED,
            label: LABELS[CLASSIFICATION.UNDETERMINED],
            confidence: 0,
            isNew: true,
            isPreliminary: false
        };
    }

    // 2. Risk Score Calculation (Weighted)
    let riskScore = (100 - reliabilityScore) * 0.6 + (missed * 5) * 0.3 + (queries * 3) * 0.1;
    
    // Clamp between 0-100
    riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    // 3. Classification
    let riskLevel = CLASSIFICATION.LOW;
    if (riskScore > 60) {
        riskLevel = CLASSIFICATION.HIGH;
    } else if (riskScore > 30) {
        riskLevel = CLASSIFICATION.MEDIUM;
    }

    // 4. Confidence Score Calculation
    // Normalizing against 30-day window
    const logsWeight = Math.min(1, (logs / 30)) * 0.5;
    const activeWeight = Math.min(1, (expected / 30)) * 0.3;
    const missedFactor = Math.max(0, 1 - (missed / 30)) * 0.2;
    
    let confidence = logsWeight + activeWeight + missedFactor;
    confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

    // 5. Preliminary check (logs < 5 days)
    const isPreliminary = logs < 5;

    return {
        riskScore,
        riskLevel,
        label: LABELS[riskLevel],
        confidence,
        isNew: false,
        isPreliminary
    };
};

module.exports = { predictRisk, CLASSIFICATION, LABELS };
