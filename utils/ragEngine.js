const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const docsDir = path.join(__dirname, '..', 'docs');

/**
 * Loads all JSON documents from the docs folder
 */
const loadDocs = () => {
    const docs = {};
    try {
        const files = fs.readdirSync(docsDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const filePath = path.join(docsDir, file);
                const rawContent = fs.readFileSync(filePath, 'utf8').trim();
                if (rawContent) {
                    try {
                        const content = JSON.parse(rawContent);
                        docs[file.replace('.json', '')] = content;
                    } catch (e) {
                        logger.warn('[ragEngine] Skipping malformed JSON', { file });
                    }
                }
            }
        });

    } catch (error) {
        logger.error('[ragEngine] Failed to load docs', error);
    }
    return docs;
};

/**
 * Detects if the query is a simple greeting
 */
const isGreeting = (query) => {
    const greetings = ['hi', 'hello', 'hey', 'greetings', 'sup', 'yo', 'morning', 'afternoon', 'evening'];
    const cleanQuery = query.toLowerCase().trim().replace(/[?!.]/g, '');
    return greetings.includes(cleanQuery);
};

/**
 * Classifies if the query is platform-related or general
 */
const classifyQuery = (query) => {
    const queryLower = query.toLowerCase();
    
    // Team classification keywords
    const teamKeywords = ['who is', 'team', 'ceo', 'cmo', 'cto', 'cpo', 'coo', 'founder', 'member', 'kabir', 'rohan', 'samarth', 'vijay', 'vaibhav'];
    if (teamKeywords.some(k => queryLower.includes(k))) return 'team';

    const platformKeywords = [
        'job', 'proposal', 'connect', 'payment', 'profile', 'dashboard', 'hire', 
        'freelancer', 'client', 'contract', 'milestone', 'escrow', 'withdraw', 
        'fee', 'verify', 'id', 'identity', 'badge', 'support', 'dispute', 'refund'
    ];
    return platformKeywords.some(k => queryLower.includes(k)) ? 'platform' : 'general';
};

/**
 * Searches the team.json document for specific members or roles
 */
const searchTeam = (query) => {
    const allDocs = loadDocs();
    const team = allDocs.team || [];
    const queryLower = query.toLowerCase();

    // Check for specific member by name (smarter matching: check if query contains any part of the name)
    const member = team.find(m => {
        const nameParts = m.name.toLowerCase().split(/\s+/);
        return nameParts.some(part => queryLower.includes(part));
    });
    if (member) return member;

    // Check for role
    const roleMap = {
        'ceo': 'CEO',
        'chief executive officer': 'CEO',
        'cmo': 'CMO',
        'chief marketing officer': 'CMO',
        'cto': 'CTO',
        'chief technology officer': 'CTO',
        'cpo': 'CPO',
        'chief product officer': 'CPO',
        'coo': 'COO',
        'chief operations officer': 'COO',
        'founder': 'Founder'
    };

    for (const [key, value] of Object.entries(roleMap)) {
        if (queryLower.includes(key)) {
            return team.find(m => m.role.toLowerCase().includes(value.toLowerCase()));
        }
    }

    return null;
};

/**
 * Searches the loaded documents for content matching the query
 */
const getContext = (query) => {
    const allDocs = loadDocs();
    const queryLower = query.toLowerCase();
    
    // Filter out common stop words to reduce noise
    const stopWords = ['the', 'and', 'for', 'who', 'how', 'what', 'where', 'are', 'can', 'you', 'with'];
    const queryWords = queryLower.split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w));
    
    let contextParts = [];

    const isMatch = (text, keywords = []) => {
        const textLower = (text || '').toLowerCase();
        if (textLower.includes(queryLower)) return true;
        if (queryWords.length === 0) return false;
        
        const matches = queryWords.filter(word => 
            textLower.includes(word) || keywords.some(k => (k || '').toLowerCase().includes(word))
        );
        return matches.length >= 1;
    };

    // Prioritize Team information
    if (allDocs.team) {
        allDocs.team.forEach(m => {
            if (isMatch(m.name) || isMatch(m.role) || isMatch(m.description)) {
                contextParts.push(`[Team Member] ${m.name}: ${m.role}. ${m.description}`);
            }
        });
    }

    if (allDocs.features) {
        allDocs.features.forEach(f => {
            if (isMatch(f.feature, f.keywords) || isMatch(f.description, f.keywords)) {
                contextParts.push(`[Feature] ${f.feature}: ${f.description} (Role: ${f.role})`);
            }
        });
    }

    if (allDocs.flows) {
        allDocs.flows.forEach(f => {
            if (isMatch(f.flow, f.keywords)) {
                contextParts.push(`[Workflow] ${f.flow}: Steps: ${f.steps.join(' -> ')}`);
            }
        });
    }

    if (allDocs.buttons) {
        allDocs.buttons.forEach(b => {
            if (isMatch(b.button) || isMatch(b.action)) {
                contextParts.push(`[UI Element] Button "${b.button}" at ${b.location}: ${b.action}. (URL: ${b.path})`);
            }
        });
    }

    if (allDocs.policies) {
        allDocs.policies.forEach(p => {
            if (isMatch(p.title, p.keywords) || isMatch(p.content, p.keywords)) {
                contextParts.push(`[Policy] ${p.title}: ${p.content}`);
            }
        });
    }

    if (allDocs.faq) {
        allDocs.faq.forEach(f => {
            if (isMatch(f.question) || isMatch(f.answer)) {
                contextParts.push(`[FAQ] Q: ${f.question} | A: ${f.answer}`);
            }
        });
    }

    const uniqueParts = [...new Set(contextParts)];
    return uniqueParts.slice(0, 5).join('\n\n');
};


module.exports = { getContext, classifyQuery, isGreeting, searchTeam };

