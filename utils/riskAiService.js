const Groq = require('groq-sdk');
const logger = require('./logger');
let groq;

if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const getFallbackInsight = (confidence = 0) => ({
    summary: "Performance remains stable and consistent with expected benchmarks.",
    suggestion: "Monitor progress regularly to ensure continued alignment with project goals.",
    confidence: confidence,
    generated_at: new Date().toISOString()
});

/**
 * Calls Groq 8B for probabilistic risk EXPLANATIONS only.
 * Always deterministic on riskLevel.
 */
const getAiRiskInsight = async (stats, riskLevel, riskScore) => {
    // Only attempt AI if there's an API key
    if (!process.env.GROQ_API_KEY) {
        return getFallbackInsight();
    }

    const model = 'llama3-8b-8192'; // Fast + Cost effective
    
    const systemPrompt = `You are "Project Assurance AI".
    Analyze these behavioral stats for project risk:
    - Reliability Score: ${stats.score}
    - Missed Updates: ${stats.missed}
    - Client Queries: ${stats.queries}
    - Determined Risk: ${riskLevel} (${riskScore}/100)
    
    TASK: Explain the REASON behind the ${riskLevel} risk level.
    NO decision making. NO markdown.
    
    Respond ONLY with raw JSON:
    {
      "summary": "1 sentence explanation of risk pattern",
      "suggestion": "1 actionable advice for the client to mitigate this specific risk"
    }`;

    try {
        const response = await groq.chat.completions.create({
            model: model,
            messages: [{ role: 'system', content: systemPrompt }],
            temperature: 0.1, // High determinism
            max_tokens: 200,
            response_format: { type: "json_object" }
        });

        const raw = response.choices[0].message.content;
        try {
            const parsed = JSON.parse(raw);
            // Validation: Ensure required fields exist
            if (!parsed.summary || !parsed.suggestion) {
                throw new Error('Invalid AI response structure');
            }

            return {
                ...parsed,
                confidence: stats.confidence || 0.8, // Default confidence from stats if available
                generated_at: new Date().toISOString()
            };
        } catch (parseError) {
            logger.error('[RiskAI] JSON Parse/Validation Error:', parseError, raw);
            return getFallbackInsight();
        }
    } catch (error) {
        logger.error(`[RiskAI] Model ${model} Error:`, error.message);
        return getFallbackInsight();
    }
};

module.exports = { getAiRiskInsight };
