const supabase = require('../supabase/client');
const { predictDeadlineFailure } = require('../utils/deadlinePredictor');
const { getDeadlineRiskExplanation } = require('../utils/deadlineAiService');
const { predictRisk } = require('../utils/riskPredictor');
const { calculateReliabilityScore } = require('../utils/reliabilityCalculator');
const logger = require('../utils/logger');

/**
 * Calculates deadline failure probability for an active job contract.
 */
const getJobDeadlineRisk = async (jobId) => {
    try {
        // 1. Fetch Job and Active Contract
        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('title, client_id')
            .eq('id', jobId)
            .single();

        if (jobError || !job) throw new Error('Job not found');

        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, freelancer_id, end_date, start_date')
            .eq('job_id', jobId)
            .eq('status', 'ACTIVE')
            .single();

        if (contractError || !contract) {
            return {
                status: 'pending_contract',
                message: 'No active contract found for this job.'
            };
        }

        // 2. Fetch Freelancer Stats
        const freelancerId = contract.freelancer_id;
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('reliability_score, risk_analysis, risk_last_updated')
            .eq('user_id', freelancerId)
            .single();

        if (profileError || !profile) throw new Error('Freelancer profile not found');

        // Calculate fresh stats for consistency and missed days
        const { stats } = await calculateReliabilityScore(freelancerId);
        
        // Calculate dynamic risk score (K)
        const riskResult = predictRisk(profile.reliability_score || 100, stats);
        
        // Calculate Consistency (C)
        const consistency = stats.expected > 0 
            ? Math.round((stats.logs / stats.expected) * 100) 
            : 100;

        // 3. Timeframe Logic (D)
        let daysRemaining = null;
        if (contract.end_date) {
            const now = new Date();
            const deadline = new Date(contract.end_date);
            daysRemaining = (deadline - now) / (1000 * 60 * 60 * 24);
        }

        // 4. Run Mathematical Model
        const result = predictDeadlineFailure(
            riskResult.riskScore,
            profile.reliability_score || 100,
            stats.missed,
            consistency,
            daysRemaining
        );

        // 5. Check Confidence Threshold
        // If contract started < 3 days ago, mark as preliminary
        const contractStart = new Date(contract.start_date);
        const now = new Date();
        const daysSinceStart = (now - contractStart) / (1000 * 60 * 60 * 24);
        const isPreliminary = daysSinceStart < 3;

        // 6. Handle AI Insight Cache (Optional, simple check here)
        // For production, we'd store the deadline analysis too. 
        // For now, we fetch AI insight live but we could cache it in profile if needed.
        const insight = await getDeadlineRiskExplanation(
            result.probability,
            result.riskLevel,
            result.factors
        );

        return {
            success: true,
            data: {
                probability: result.probability,
                risk: result.riskLevel,
                label: result.label,
                isPreliminary,
                confidence: riskResult.confidence,
                factors: {
                    reliability: profile.reliability_score,
                    missed_days: stats.missed,
                    consistency: consistency,
                    risk_score: riskResult.riskScore
                },
                insight
            }
        };

    } catch (error) {
        logger.error('[Service] getJobDeadlineRisk error', error);
        throw error;
    }
};

/**
 * Calculates deadline failure probability for a specific contract.
 */
const getContractDeadlineRisk = async (contractId) => {
    try {
        // 1. Fetch Contract
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, freelancer_id, end_date, start_date, job_id, title')
            .eq('id', contractId)
            .single();

        if (contractError || !contract) throw new Error('Contract not found');

        // 2. Fetch Freelancer Stats
        const freelancerId = contract.freelancer_id;
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('reliability_score')
            .eq('user_id', freelancerId)
            .single();

        if (profileError || !profile) throw new Error('Freelancer profile not found');

        const { stats } = await calculateReliabilityScore(freelancerId);
        const riskResult = predictRisk(profile.reliability_score || 100, stats);
        
        const consistency = stats.expected > 0 
            ? Math.round((stats.logs / stats.expected) * 100) 
            : 100;

        // 3. Timeframe Logic
        let daysRemaining = null;
        if (contract.end_date) {
            const now = new Date();
            const deadline = new Date(contract.end_date);
            daysRemaining = (deadline - now) / (1000 * 60 * 60 * 24);
        }

        // 4. Run Mathematical Model
        const result = predictDeadlineFailure(
            riskResult.riskScore,
            profile.reliability_score || 100,
            stats.missed,
            consistency,
            daysRemaining
        );

        const contractStart = new Date(contract.start_date);
        const now = new Date();
        const daysSinceStart = (now - contractStart) / (1000 * 60 * 60 * 24);
        const isPreliminary = daysSinceStart < 3;

        // 5. AI Insight
        const insight = await getDeadlineRiskExplanation(
            result.probability,
            result.riskLevel,
            result.factors
        );

        return {
            success: true,
            data: {
                probability: result.probability,
                risk_level: result.riskLevel,
                label: result.label,
                isPreliminary,
                confidence: riskResult.confidence,
                factors: {
                    reliability: profile.reliability_score,
                    missed_days: stats.missed,
                    consistency: consistency,
                    risk_score: riskResult.riskScore
                },
                ai_analysis: insight
            }
        };

    } catch (error) {
        logger.error('[Service] getContractDeadlineRisk error', error);
        throw error;
    }
};

module.exports = {
    getJobDeadlineRisk,
    getContractDeadlineRisk
};
