const Groq = require('groq-sdk');
const logger = require('./logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const FALLBACK_INSIGHT = {
    summary: "Performance remains stable and consistent with platform standards.",
    risk: "low",
    suggestion: "Maintain daily work logs to keep your trust score at its peak."
};

const getAIInsight = async (stats, modelType = '70b', audience = 'freelancer') => {
    // Using versatile/instant models for performance and reliability
    const model = modelType === '70b' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    
    const isFreelancer = audience === 'freelancer';
    const perspective = isFreelancer ? "the freelancer viewing their own health" : "a client reviewing a freelancer";
    const person = isFreelancer ? "You" : "The freelancer";

    const systemPrompt = `You are "Connect Trust Engine", an AI that analyzes freelancer performance.
    Context: You are writing to ${perspective}. Use ${isFreelancer ? 'second-person' : 'third-person'} perspective (e.g., "${person} had...").
    
    Analyze these 30-day stats:
    - Days with work expected: ${stats.expected}
    - Days logs submitted: ${stats.logs}
    - Missed log days: ${stats.missed}

    - Client queries about work: ${stats.queries}
    
    Respond ONLY with raw JSON in this format:
    {
      "summary": "1-2 sentences summarizing performance",
      "risk": "low" | "medium" | "high",
      "suggestion": "One actionable tip for improvement"
    }
    
    RULES:
    1. If expected days is 0, welcome them as a new freelancer.
    2. Be professional and objective.
    3. NO markdown, NO preamble.`;


    try {
        const response = await groq.chat.completions.create({
            model: model,
            messages: [{ role: 'system', content: systemPrompt }],
            temperature: 0.5,
            max_tokens: 300,
            response_format: { type: "json_object" }
        });

        const raw = response.choices[0].message.content;
        try {
            return JSON.parse(raw);
        } catch (parseError) {
            logger.error('[AIInsight] JSON Parse Error:', parseError, raw);
            throw parseError; 
        }
    } catch (error) {
        logger.error(`[AIInsight] Model ${model} Error:`, error.message);
        throw error;
    }
}

/**
 * Multi-level failsafe AI Insight fetcher
 * 70B (Primary) -> 8B (Fallback) -> Hardcoded Fallback
 */
const fetchReliabilityInsight = async (stats, currentTarget = '70b', audience = 'freelancer') => {
    try {
        // Only attempt AI if there's an API key
        if (!process.env.GROQ_API_KEY) {
            return FALLBACK_INSIGHT;
        }
        return await getAIInsight(stats, currentTarget, audience);
    } catch (error) {
        if (currentTarget === '70b') {
            logger.warn('[AIInsight] 70B failed, falling back to 8B');
            return fetchReliabilityInsight(stats, '8b', audience);
        }
        logger.error('[AIInsight] Both models failed, using hardcoded fallback');
        return FALLBACK_INSIGHT;
    }
}


module.exports = { fetchReliabilityInsight };
