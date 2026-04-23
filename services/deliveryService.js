const Groq = require('groq-sdk');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * AI VALIDATION FOR WORK SUBMISSION
 * Ensures message is descriptive and link looks valid.
 */
exports.validateSubmissionWithAI = async (message, work_link, delivery_type) => {
    if (!process.env.GROQ_API_KEY) {
        console.warn('[AI Validation] GROQ_API_KEY missing - skipping AI validation');
        return { success: true };
    }

    try {
        const prompt = `
            You are an expert project manager. Analyze the following work submission:
            Delivery Type: ${delivery_type}
            Message from Freelancer: "${message}"
            Work Link: "${work_link || 'N/A'}"
            
            Evaluate if the submission looks complete and professional.
            Provide feedback ONLY in JSON format:
            {
                "isValid": boolean,
                "score": number (0-100),
                "feedback": "short actionable feedback if invalid or low score",
                "suggestions": ["suggestion1", "suggestion2"]
            }
        `;

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const result = JSON.parse(response.choices[0].message.content);
        return result;
    } catch (err) {
        logger.error('[AI Validation Error]', err);
        return { success: true, feedback: 'AI validation unavailable' }; // Fallback to pass
    }
};

/**
 * EMIT DELIVERY EVENTS
 * Handles notifications and side effects.
 */
exports.emitDeliveryEvent = async (type, payload) => {
    const { delivery, contract } = payload;
    
    try {
        let title = '';
        let content = '';
        let recipientId = '';

        if (type === 'SUBMITTED') {
            title = 'New Work Submission';
            content = `Version ${delivery.version} has been submitted for ${contract.jobs?.title || 'your contract'}.`;
            recipientId = contract.client_id;
        } else if (type === 'APPROVED') {
            title = 'Work Approved! 🚀';
            content = `Great news! Your work for ${contract.jobs?.title || 'your contract'} was approved.`;
            recipientId = contract.freelancer_id;
        } else if (type === 'REVISION_REQUESTED') {
            title = 'Revision Requested';
            content = `The client requested a revision for ${contract.jobs?.title || 'your contract'}. Check the feedback.`;
            recipientId = contract.freelancer_id;
        }

        // 1. Create In-App Notification
        await adminClient.from('notifications').insert([{
            user_id: recipientId,
            title,
            content,
            type: 'CONTRACT_UPDATE',
            link: `/dashboard/contracts/${contract.id}`
        }]);

        // 2. Here you could add Socket.io emits or Emails if needed
        console.log(`[Event] ${type} for delivery ${delivery.id} processed.`);

    } catch (err) {
        logger.error('[Delivery Event Error]', err);
    }
};

/**
 * STORAGE CLEANUP
 * Removes files from 'pending/' folder older than 24h.
 * Note: This would typically be called by a cron job.
 */
exports.cleanupOldPendingFiles = async () => {
    // Logic implementation for storage cleanup would require listing by date
    // Supabase JS doesn't have a direct 'list by date' filter in storage, 
    // so we'd have to list all and filter manually or use a DB-managed table for pending files.
    console.log('[Cleanup] Storage cleanup logic triggered.');
};
