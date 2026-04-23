/**
 * Deadline Failure Predictor (Deterministic Math Model)
 * Formula: failure_probability = (K * 0.4) + ((100 - R) * 0.3) + (M * 2) + ((100 - C) * 0.2)
 * K: risk_score (0-100)
 * R: reliability_score (0-100)
 * M: missed_days (last 30 days)
 * C: consistency % (logs submitted / expected)
 */

const CLASSIFICATION = {
    LOW: { label: 'Reliable', range: [0, 30], color: 'green' },
    MEDIUM: { label: 'Moderate Risk', range: [31, 60], color: 'yellow' },
    HIGH: { label: 'High Probability of Delay', range: [61, 100], color: 'red' }
};

const predictDeadlineFailure = (riskScore, reliabilityScore, missedDays, consistency, daysRemaining) => {
    // 1. Calculate Base Probability
    let probability = (riskScore * 0.4) + 
                      ((100 - reliabilityScore) * 0.3) + 
                      (missedDays * 2) + 
                      ((100 - consistency) * 0.2);

    // 2. Deadline Pressure Adjustments
    if (daysRemaining !== null) {
        if (daysRemaining < 1) {
            probability += 25;
        } else if (daysRemaining < 3) {
            probability += 15;
        }
    }

    // 3. Clamp between 0-100
    const finalProbability = Math.max(0, Math.min(100, Math.round(probability)));

    // 4. Determine Risk Level
    let riskLevel = 'low';
    let label = CLASSIFICATION.LOW.label;

    if (finalProbability > 60) {
        riskLevel = 'high';
        label = CLASSIFICATION.HIGH.label;
    } else if (finalProbability > 30) {
        riskLevel = 'medium';
        label = CLASSIFICATION.MEDIUM.label;
    }

    return {
        probability: finalProbability,
        riskLevel,
        label,
        factors: {
            riskScore,
            reliabilityScore,
            missedDays,
            consistency
        }
    };
};

module.exports = {
    predictDeadlineFailure,
    CLASSIFICATION
};
