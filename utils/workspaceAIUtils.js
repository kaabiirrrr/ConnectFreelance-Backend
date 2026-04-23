const Groq = require('groq-sdk');
const logger = require('./logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Validates the quality of a work scope using Groq (Llama 3.3).
 * Returns { isValid: boolean, feedback: string, suggestedScope?: string }
 */
exports.validateMissionScope = async (role, scope) => {
    try {
        if (!process.env.GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY missing');
        }

        const systemPrompt = `You are an expert project manager and hiring consultant. 
        Your job is to validate the "Scope of Work" assigned to a freelancer in a team workspace.
        
        RULES:
        1. The scope must be clear, specific, and actionable.
        2. It should avoid vague language like "do work", "handle things", "help out".
        3. For the role "${role}", the scope should ideally mention specific technical tasks or boundaries.
        
        Respond ONLY with raw JSON:
        {
            "isValid": boolean, // Be lenient. Only return false if the scope is completely nonsense or impossible to understand.
            "feedback": "Brief feedback on how to make it better",
            "suggestedImprovements": "A more professional version of the scope"
        }`;

        const userContent = `Role: ${role}\nScope provided: "${scope}"\n\nPlease validate this scope.`;

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.1, // Low temp for consistent validation
            max_tokens: 500,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        return result;

    } catch (error) {
        logger.error('[AI Scope Validation] Failed', error);
        
        // --- FALLBACK LOGIC ---
        // If AI fails, use a simple heuristic to not block the user entirely
        const isLongEnough = scope.length >= 25;
        const hasVagueWords = /\b(do work|stuff|things|help)\b/i.test(scope);
        
        return {
            isValid: isLongEnough && !hasVagueWords,
            feedback: isLongEnough ? "Basic validation passed." : "Scope is too short. Please be more specific.",
            isFallback: true
        };
    }
};

/**
 * Uses AI to optimize a rough scope description.
 */
exports.suggestScopeImprovement = async (role, category, roughScope) => {
    try {
        const systemPrompt = `You are an expert Project Manager. Transform a rough, informal scope of work into a professional, clear, and boundary-focused mission statement for a freelancer.
        Role: ${role}
        Project Category: ${category}
        
        Respond ONLY with the improved text. Keep it concise (2-3 sentences max).`;

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: roughScope }
            ],
            temperature: 0.7,
            max_tokens: 300
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        logger.error('[AI Scope Optimization] Failed', error);
        return roughScope; // Return original on failure
    }
};
/**
 * Uses Groq to analyze proposal risk (Underpriced, Overpriced, Skill Mismatch).
 * Returns { riskLevel: 'low' | 'medium' | 'high', flag: string, feedback: string }
 */
exports.analyzeProposalRisk = async ({ roleTitle, roleBudget, bidAmount, freelancerSkills, freelancerBio }) => {
    try {
        if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

        const systemPrompt = `You are an AI hiring auditor for a freelance marketplace.
        Evaluate the risk of a freelancer's proposal based on the role and their profile.
        
        CRITERIA:
        1. UNDERPRICED (High Risk): Bid is significantly lower (e.g., < 40%) than budget. Might indicate lack of understanding or fake profile.
        2. OVERPRICED (Medium/High Risk): Bid is significantly higher (e.g., > 150%) than budget.
        3. SKILL MISMATCH: Compare the role title to the freelancer's skills and bio.
        
        Respond ONLY with raw JSON:
        {
            "riskLevel": "low" | "medium" | "high",
            "flag": "Suspicious Bid (Too Low)" | "Overpriced" | "Fair Bid" | "Skill Mismatch",
            "feedback": "Brief explanation of the risk assessment"
        }`;

        const userContent = `
        Role: ${roleTitle}
        Budget: $${roleBudget}
        Freelancer Bid: $${bidAmount}
        Freelancer Skills: ${JSON.stringify(freelancerSkills)}
        Freelancer Bio: ${freelancerBio}
        `;

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        logger.error('[AI Risk Analysis] Failed', error);
        
        // --- SIMPLE HEURISTIC FALLBACK ---
        const ratio = bidAmount / roleBudget;
        if (ratio < 0.4) return { riskLevel: 'high', flag: 'Suspicious Bid (Too Low)', feedback: 'Bid is unusually low compared to role budget.' };
        if (ratio > 1.5) return { riskLevel: 'medium', flag: 'Overpriced', feedback: 'Bid is significantly above the suggested budget.' };
        return { riskLevel: 'low', flag: 'Fair Bid', feedback: 'Bid is within a reasonable range.' };
    }
};
