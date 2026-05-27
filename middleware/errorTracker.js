const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

// Map route paths to human-readable feature names
const FEATURE_MAP = {
    '/api/auth': 'Authentication',
    '/api/proposals': 'Proposal Submit',
    '/api/payments': 'Payment',
    '/api/contracts': 'Contracts',
    '/api/jobs': 'Jobs',
    '/api/profile': 'Profile',
    '/api/messages': 'Messaging',
    '/api/disputes': 'Disputes',
    '/api/connects': 'Connects',
    '/api/support': 'Support',
    '/api/work-diary': 'Work Diary',
    '/api/services': 'Services',
    '/api/reviews': 'Reviews',
    '/api/notifications': 'Notifications',
    '/api/identity': 'Identity Verification',
    '/api/meetings': 'Meetings',
};

const getFeatureName = (path) => {
    for (const [prefix, name] of Object.entries(FEATURE_MAP)) {
        if (path.startsWith(prefix)) return name;
    }
    const parts = path.split('/').filter(Boolean);
    return parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : 'Unknown';
};

/**
 * Error tracking middleware — logs 4xx/5xx errors to error_logs table.
 * Mount AFTER routes: app.use(errorTracker)
 */
const errorTracker = (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (body) {
        // Only log errors (4xx/5xx) for authenticated users
        if (res.statusCode >= 400 && req.user?.id) {
            const feature = getFeatureName(req.originalUrl || req.path);
            const errorMessage = body?.message || body?.error || `HTTP ${res.statusCode}`;

            // Fire-and-forget — never block the response
            adminClient.from('error_logs').insert({
                user_id: req.user.id,
                user_email: req.user.email || null,
                feature,
                endpoint: `${req.method} ${req.originalUrl}`,
                error_message: errorMessage,
                status_code: res.statusCode,
                metadata: {
                    body: req.method !== 'GET' ? req.body : undefined,
                    userAgent: req.headers['user-agent'],
                }
            }).then(({ error }) => {
                if (error) logger.warn('[ErrorTracker] Failed to log error:', error.message);
            });
        }

        return originalJson(body);
    };

    next();
};

module.exports = errorTracker;
