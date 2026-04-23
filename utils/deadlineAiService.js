const Groq = require('groq-sdk');
const logger = require('./logger');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/**
 * Explains the deadline failure probability using LLaMA 3 8B.
 */
const getDeadlineRiskExplanation = async (probability, riskLevel, factors) => {
    try {
        const prompt = `
        You are a project management risk analyst. 
        A freelancer has a ${probability}% probability of failing or delaying their project deadline.
        Risk Level: ${riskLevel.toUpperCase()}

        Behavioral Factors:
        - Reliability Score: ${factors.reliabilityScore}/100
        - Recent Missed Days: ${factors.missedDays}
        - Consistency: ${factors.consistency}%
        - Underlying Risk Score: ${factors.riskScore}/100

        Task:
        Provide a concise, professional summary for the client explaining WHY this risk level exists and suggest ONE specific mitigation action.
        Keep the tone objective and helpful.

        Return ONLY a JSON object:
        {
            "summary": "Short explanation of risk factors",
            "suggestion": "Actionable step for the client"
        }
        `;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama3-8b-8192',
            temperature: 0.5,
            max_tokens: 300,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(chatCompletion.choices[0].message.content);
        return result;

    } catch (error) {
        logger.error('[AI] Deadline Risk Explanation error', error);
        return {
            summary: "Behavioral patterns indicate current risk level.",
            suggestion: "Reach out to the freelancer for a progress update."
        };
    }
};

module.exports = {
    getDeadlineRiskExplanation
};
