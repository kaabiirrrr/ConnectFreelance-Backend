const Groq = require('groq-sdk');
const logger = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = require('../supabase/client');
const { getContext, classifyQuery, isGreeting, searchTeam } = require('../utils/ragEngine');
const { suggestScopeImprovement } = require('../utils/workspaceAIUtils');

async function callAI(systemPrompt, userContent) {
    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ],
        temperature: 0.7,
        max_tokens: 1000
    });
    return response.choices[0].message.content;
}

function parseJSON(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
}

// POST /api/ai/chat
exports.chat = async (req, res, next) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, message: 'message is required' });

        let systemPrompt = '';
        let context = '';

        if (isGreeting(message)) {
            systemPrompt = `You are "Connect AI", the friendly assistant for the Connect freelance platform. 
            Greet the user warmly and ask how you can help them with their hiring or freelancing needs today. 
            Keep it professional and upbeat.`;
        } else {
            const queryType = classifyQuery(message);

            if (queryType === 'team') {
                const member = searchTeam(message);
                if (member) {
                    systemPrompt = `You are "Connect AI". The user is asking about a specific team member or role.
                    Provide the following information accurately:
                    ${member.name} is the ${member.role}. ${member.description}
                    
                    RULES:
                    1. Use the provided information exactly.
                    2. Do NOT guess or add extra details not mentioned.
                    3. Format it cleanly for the user.`;
                } else {
                    const allDocs = getContext(message);
                    systemPrompt = `You are "Connect AI". The user is asking about the team or a team-related topic.
                    Use the following team context to answer briefly:
                    ${allDocs}
                    
                    If no specific team data is found in the context, list the key founders: Kabir More (CEO) and Rohan Patil (CMO).`;
                }
            } else if (queryType === 'platform') {
                context = getContext(message);
                if (context) {
                    systemPrompt = `You are "Connect AI". Answer the user's platform-specific question accurately using the Context provided below.
                    RULES:
                    1. Use ONLY the provided context if it contains the answer.
                    2. Mention specific buttons or pages if they are in the context.
                    3. Be concise and helpful.
                    
                    CONTEXT:
                    ${context}`;
                } else {
                    systemPrompt = `You are "Connect AI". The user is asking about a platform feature but I couldn't find the exact documentation.
                    DO NOT say "I couldn't find that". Instead, give a helpful, general guide on how such features typically work on a freelance platform like Connect.
                    Encourage them to check the "Help" section or contact support for precise steps.`;
                }
            } else {
                systemPrompt = `You are "Connect AI", a helpful assistant for users on the Connect freelance platform.
                The user has a general question. Answer it politely and intelligently using your general knowledge.
                Try to relate it back to freelancing or productivity if possible, but don't force it.`;
            }
        }

        const reply = await callAI(systemPrompt, message);

        // Log interaction (Async)
        supabase.from('ai_interactions').insert({
            user_id: req.user?.id,
            question: message,
            response: reply,
            context_used: context || 'None',
            has_context: !!context,
            metadata: { type: isGreeting(message) ? 'greeting' : classifyQuery(message) }
        }).then(({ error }) => {
            if (error) logger.error('[AI Log Error]', error);
        });

        res.json({ success: true, data: { reply } });
    } catch (err) {
        logger.error('[AI] chat error', err);
        next(err);
    }
};

// POST /api/ai/generate-job
exports.generateJobPost = async (req, res) => {
    try {
        const { idea } = req.body;
        if (!idea) return res.status(400).json({ success: false, message: 'idea is required' });

        const raw = await callAI(
            'You are an expert freelance platform assistant. Convert rough job ideas into professional job posts. Respond ONLY with raw JSON, no markdown: {"title":"...","description":"...","budget":"...","skills":["skill1","skill2"]}',
            `Convert this idea into a job post: "${idea}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] generate-job error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/improve-job
exports.improveJobPost = async (req, res) => {
    try {
        const { jobPost } = req.body;
        if (!jobPost) return res.status(400).json({ success: false, message: 'jobPost is required' });

        const raw = await callAI(
            'You are an expert freelance platform assistant. Improve job posts to be professional and clear. Respond ONLY with raw JSON, no markdown: {"improvedPost":"...","suggestions":"..."}',
            `Improve this job post: "${jobPost}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] improve-job error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/suggest-skills
exports.suggestSkills = async (req, res) => {
    try {
        const { category } = req.body;
        if (!category) return res.status(400).json({ success: false, message: 'category is required' });

        const raw = await callAI(
            'You are a freelance platform expert. Suggest relevant skills for job categories. Respond ONLY with raw JSON, no markdown: {"skills":["skill1","skill2","skill3"]}',
            `Suggest skills for: "${category}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] suggest-skills error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/generate-proposal
exports.generateProposal = async (req, res) => {
    try {
        const { jobDescription } = req.body;
        if (!jobDescription) return res.status(400).json({ success: false, message: 'jobDescription is required' });

        const raw = await callAI(
            'You are an expert at writing winning freelance proposals. Respond ONLY with raw JSON, no markdown: {"proposal":"..."}',
            `Write a proposal for this job: "${jobDescription}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] generate-proposal error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/optimize-profile
exports.optimizeProfile = async (req, res) => {
    try {
        const { bio } = req.body;
        if (!bio) return res.status(400).json({ success: false, message: 'bio is required' });

        const raw = await callAI(
            'You are a freelance career coach. Rewrite freelancer profiles to be compelling. Respond ONLY with raw JSON, no markdown: {"optimizedBio":"...","title":"..."}',
            `Optimize this bio: "${bio}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] optimize-profile error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/bid-strategy
exports.bidStrategy = async (req, res) => {
    try {
        const { jobDescription } = req.body;
        if (!jobDescription) return res.status(400).json({ success: false, message: 'jobDescription is required' });

        const raw = await callAI(
            'You are a freelance bidding strategist. Advise on competitive pricing. Respond ONLY with raw JSON, no markdown: {"recommendedRate":"...","strategy":"..."}',
            `Suggest bid strategy for: "${jobDescription}"`
        );
        res.json({ success: true, data: parseJSON(raw) });
    } catch (err) {
        logger.error('[AI] bid-strategy error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};

// POST /api/ai/optimize-mission
exports.optimizeMission = async (req, res) => {
    try {
        const { role, category, roughScope } = req.body;
        if (!roughScope) return res.status(400).json({ success: false, message: 'roughScope is required' });

        const improved = await suggestScopeImprovement(
            role || 'Freelancer',
            category || 'General',
            roughScope
        );

        res.json({ success: true, data: improved });
    } catch (err) {
        logger.error('[AI] optimize-mission error', err);
        res.status(500).json({ success: false, message: 'AI request failed' });
    }
};
