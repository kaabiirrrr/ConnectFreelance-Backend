const Groq = require('groq-sdk');
const crypto = require('crypto');
const logger = require('../utils/logger');
const redisUtil = require('../utils/redis');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/**
 * Advanced Normalization Engine
 * Handles: phonetic numbers, symbol tricks, Unicode widened digits, and whitespace obfuscation.
 */
const normalize = (text) => {
    if (!text) return '';
    
    // 1. Unicode Normalization (handles widened digits like ９ -> 9)
    let normalized = text.normalize('NFKD').toLowerCase();

    // 2. Clear common symbol tricks and phonetic words
    normalized = normalized
        .replace(/\s+/g, '') // Strip all spaces
        .replace(/\(at\)|\[at\]|\s+at\s+/g, '@')
        .replace(/\(dot\)|\[dot\]|\s+dot\s+/g, '.')
        .replace(/zero/g, '0').replace(/one/g, '1')
        .replace(/two/g, '2').replace(/three/g, '3')
        .replace(/four/g, '4').replace(/five/g, '5')
        .replace(/six/g, '6').replace(/seven/g, '7')
        .replace(/eight/g, '8').replace(/nine/g, '9')
        .replace(/[^\w@.]/g, ''); // Strip special chars except @ and .

    return normalized;
};

/**
 * SHA-256 Hashing for Fingerprinting
 */
const hashContent = (text) => {
    return crypto.createHash('sha256').update(text).digest('hex');
};

/**
 * Fast Regex check for obvious contacts
 */
const checkRegex = (text) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/g;
    
    const hasEmail = emailRegex.test(text);
    const hasPhone = phoneRegex.test(text);

    if (hasEmail || hasPhone) {
        return {
            violation: true,
            type: hasEmail ? 'email' : 'phone',
            severity: 'HIGH',
            reason: hasEmail ? 'Email address detected' : 'Phone number detected'
        };
    }
    return null;
};

/**
 * AI check using Groq Llama3 for semantic detection in context
 */
const checkAI = async (combinedHistory) => {
    try {
        const prompt = `
        You are a security AI for a professional freelancer platform. 
        Analyze the following sequence of messages for attempts to share contact info (email, phone, whatsapp, telegram, skype) even if SPLIT across multiple messages.
        
        Conversation Context:
        ${combinedHistory}
        
        Respond ONLY in valid JSON:
        {
          "violation": boolean,
          "type": "phone" | "email" | "off-platform" | "none",
          "severity": "LOW" | "MEDIUM" | "HIGH",
          "confidence": number (0-1),
          "reason": "Brief explanation"
        }
        `;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama3-8b-8192',
            response_format: { type: 'json_object' }
        });

        return JSON.parse(chatCompletion.choices[0].message.content);
    } catch (err) {
        logger.error('[Moderation] AI check failed', err);
        return { violation: false, confidence: 0 }; 
    }
};

/**
 * CENTRALIZED STATEFUL MODERATION (v2)
 */
exports.moderate = async (content, userId) => {
    if (!content) return { blocked: false };

    // 1. Single Message Normalization & Hash
    const currentNormalized = normalize(content);
    const contentHash = hashContent(currentNormalized);

    // 2. Anti-Spam Fingerprinting
    const repeatCount = await redisUtil.checkFingerprint(userId, contentHash);
    if (repeatCount >= 3) {
        return {
            blocked: true,
            type: 'spam',
            severity: 'MEDIUM',
            reason: 'Message blocked due to repeated spam patterns.',
            detected_by: 'FINGERPRINT'
        };
    }

    // 3. Update Conversation Buffer (Redis)
    await redisUtil.storeMessage(userId, content);
    const history = await redisUtil.getHistory(userId);
    const combined = history.join(' ');
    const combinedNormalized = normalize(combined);

    // 4. Digit Density Logic (Bypass protection)
    const digitCount = combinedNormalized.replace(/\D/g, '').length;
    const isSuspicious = digitCount >= 5 || (content.length < 4 && digitCount >= 2);

    // 5. Tier 1: Regex Scanning (Instant)
    const regexResult = checkRegex(combinedNormalized) || checkRegex(content);
    if (regexResult) {
        return { 
            blocked: true, 
            ...regexResult,
            severity: history.length > 1 ? 'HIGH' : regexResult.severity, // Split attacks are HIGH
            confidence: 1.0,
            detected_by: 'REGEX_CONTEXT'
        };
    }

    // 6. Early Block (Rule 7: Partial early blocking)
    if (digitCount >= 6 && isSuspicious) {
        // High risk of phone sharing even before 10 digits
        return {
            blocked: true,
            type: 'phone',
            severity: 'HIGH',
            reason: 'Suspicious numeric pattern crossing safety threshold.',
            detected_by: 'DENSITY_SCAN'
        };
    }

    // 7. Tier 2: AI Trigger (Performance Optimized)
    // Only run AI if patterns are suspicious and regex not hit
    if (isSuspicious || digitCount >= 8) {
        const aiResult = await checkAI(combined);
        
        if (aiResult?.violation && aiResult.confidence > 0.7) {
            return {
                blocked: true,
                ...aiResult,
                severity: history.length > 1 ? 'HIGH' : aiResult.severity,
                detected_by: 'AI_CONTEXT'
            };
        }
    }

    return { blocked: false };
};

