const adminClient = require('../supabase/adminClient');
const emailService = require('./emailService');
const logger = require('./logger');

/**
 * Checks a user's notification preferences and sends an email if allowed.
 * @param {string} targetUserId - The UUID of the user to notify
 * @param {string} eventType - The preference key (e.g., 'email_proposals', 'email_messages', 'email_contracts')
 * @param {Object} data - Payload required by the emailService function
 */
exports.checkAndSendNotification = async (targetUserId, eventType, data) => {
    try {
        if (!targetUserId) return;

        // Fetch user preferences and email. 
        // Note: The 'profiles' table might not have 'email' populated for everyone, 
        // so we join with 'users' (auth.users representation if available) or use profiles.email.
        // Let's query profiles first since we added email there in the new upsert logic.
        const { data: profile, error } = await adminClient
            .from('profiles')
            .select('email, notification_preferences')
            .eq('user_id', targetUserId)
            .maybeSingle();

        if (error || !profile) {
            logger.warn(`[NotificationHelper] Could not find profile for ${targetUserId} to send ${eventType}`);
            return;
        }

        // If no email is in profiles, we can't send. (Optionally query auth schema, but usually it's in public.users or profiles)
        const userEmail = profile.email;
        if (!userEmail) {
            logger.warn(`[NotificationHelper] No email address found for user ${targetUserId}`);
            return;
        }

        // Default preferences if not set (assume true for critical things)
        const prefs = profile.notification_preferences || {
            email_proposals: true, 
            email_messages: true, 
            email_contracts: true
        };

        // Check preference
        if (prefs[eventType] === false) {
            logger.info(`[NotificationHelper] User ${targetUserId} has ${eventType} disabled. Skipping email.`);
            return;
        }

        // Send email based on event type
        switch (eventType) {
            case 'email_proposals':
                await emailService.sendProposalEmail(userEmail, data.jobTitle, data.freelancerName);
                break;
            case 'email_messages':
                await emailService.sendMessageEmail(userEmail, data.senderName);
                break;
            case 'email_contracts':
                await emailService.sendContractUpdateEmail(userEmail, data.contractTitle, data.updateType, data.details);
                break;
            default:
                logger.warn(`[NotificationHelper] Unknown eventType: ${eventType}`);
        }
    } catch (err) {
        logger.error(`[NotificationHelper] Error processing notification for ${targetUserId}:`, err.message);
    }
};
