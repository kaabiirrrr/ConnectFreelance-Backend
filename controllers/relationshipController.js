const adminClient = require('../supabase/adminClient');
const relationshipService = require('../services/relationshipService');
const logger = require('../utils/logger');

/**
 * Trust Graph v2 - Controller
 * Standardizes API responses and implements hard failsafes.
 */

exports.getRelationshipStats = async (req, res, next) => {
    try {
        const freelancerId = req.params.freelancerId;
        let clientId = req.user.id;

        // Admin Override: Allow fetching stats for any client-freelancer pair
        if (req.user.role === 'ADMIN' && req.query.clientId) {
            clientId = req.query.clientId;
        }

        // --- HARD FAILSAFE (Polish Point #1) ---
        const DEFAULT_RESPONSE = {
            has_history: false,
            relationship: {
                projects_completed: 0,
                success_rate: 0,
                last_project_name: "No history yet",
                last_project_date: null
            },
            trust: {
                score: 75,
                level: "STABLE"
            },
            behavior: {
                on_time_rate: 100,
                avg_response_time: 0,
                revisions_avg: 0
            },
            badges: [],
            ai: {
                compatibility: 0,
                summary: "Connect to unlock insights"
            }
        };

        // 1. Query the cache table
        const { data: stats, error } = await adminClient
            .from('client_freelancer_stats')
            .select('*')
            .eq('client_id', clientId)
            .eq('freelancer_id', freelancerId)
            .maybeSingle();

        if (error) {
            logger.error('[RelationshipController] Database error', error);
            // Return safe response instead of erroring
            return res.status(200).json({ success: true, data: DEFAULT_RESPONSE });
        }

        if (!stats) {
            // No history in cache - Return failsafe (Point #7: First project boost logic)
            return res.status(200).json({ success: true, data: DEFAULT_RESPONSE });
        }

        // 2. Map to Standardized Response Structure (Polish Point #4)
        const total = stats.total_projects || 1; // Prevent div by zero
        const formatted = {
            has_history: stats.total_projects > 0,
            relationship: {
                projects_completed: stats.completed_projects,
                success_rate: Math.round((stats.completed_projects / total) * 100),
                last_project_name: stats.last_project_name,
                last_project_date: stats.last_project_date
            },
            trust: {
                score: Math.round(stats.trust_score), // Rounding (Point #2)
                level: relationshipService.getTrustLevel(stats.trust_score)
            },
            behavior: {
                on_time_rate: Math.round(stats.on_time_rate),
                avg_response_time: stats.avg_response_time,
                revisions_avg: stats.revisions_avg
            },
            badges: [],
            ai: {
                compatibility: Math.round(stats.compatibility_score),
                summary: stats.ai_summary
            }
        };

        // --- BADGE PRIORITY SYSTEM (Polish Point #6) ---
        // Priority: 1. Risk | 2. Loyalty | 3. High Trust
        
        // Threshold Check (Point #3) - Only show strong positive badges if total_projects >= 2
        const hasThreshold = stats.total_projects >= 2;

        if (stats.cancelled_projects > 2 || stats.trust_score < 60) {
            formatted.badges.push('RISK');
        } else if (hasThreshold) {
            if (stats.total_projects >= 5) {
                formatted.badges.push('LOYALTY');
            }
            // Max 2 badges
            if (formatted.badges.length < 2 && stats.trust_score >= 90) {
                formatted.badges.push('HIGH_TRUST');
            }
        }

        res.status(200).json({ success: true, data: formatted });

    } catch (err) {
        logger.error('[RelationshipController] Fatal error', err);
        // Last line of defense: Error failsafe
        res.status(200).json({ 
            success: true, 
            data: {
                has_history: false,
                trust: { score: 75, status: "stable", message: "Insights updating..." }
            }
        });
    }
};
