const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const { ROLES, ADMIN_ROLES } = require('../config/roles');
const logger = require('../utils/logger');

const ENFORCEMENT_FIELDS = 'is_banned, is_restricted, warning_count';

exports.protect = async (req, res, next) => {
    try {
        console.log(`[Auth Debug] Incoming request to: ${req.url}`);
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
            console.log(`[Auth Debug] Token found: ${token.substring(0, 10)}...`);
        } else {
            console.warn(`[Auth Debug] No Authorization header or Bearer token found for: ${req.url}`);
        }

        if (!token) {
            return res.status(401).json({ success: false, data: null, message: 'Not authorized, no token' });
        }

        let user, error;
        try {
            const res = await supabase.auth.getUser(token);
            user = res.data?.user;
            error = res.error;
        } catch (fetchErr) {
            const msg = fetchErr.message || '';
            if (msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
                logger.error(`[Auth Middleware] CRITICAL NETWORK FAILURE: ${msg}`);
                return res.status(503).json({ 
                    success: false, 
                    message: 'Security gateway unreachable. Please check your connection.',
                    error: 'network_gateway_failure'
                });
            }
            throw fetchErr;
        }

        if (error || !user) {
            const errorMsg = error?.message || 'No user found';
            const errorCode = error?.code || 'no_code';
            
            // SDK-level network check
            if (errorMsg.includes('fetch failed') || errorMsg.includes('ENOTFOUND')) {
                logger.error(`[Auth Middleware] Network connectivity issue to Supabase: ${errorMsg}`);
                return res.status(503).json({ 
                    success: false, 
                    message: 'Security gateway unreachable (SDK Error). Please check your connection.',
                    error: 'network_gateway_failure'
                });
            }

            // Production diagnostic for key mismatches or project issues
            if (errorCode === 'invalid_api_key' || errorMsg.includes('API key')) {
                logger.error(`[Auth Middleware] CRITICAL CONFIG ERROR: Supabase API Key rejected. Check Render Env Vars.`);
            }

            const isCommonAuthError = 
                errorCode === 'session_not_found' || 
                errorCode === 'bad_jwt' || 
                errorMsg.includes('session missing') || 
                errorMsg.includes('invalid') || 
                errorMsg.includes('expired');

            if (isCommonAuthError) {
                // Silent return for standard expirations/invalidations
                return res.status(401).json({
                    success: false,
                    message: 'Your session has expired or is invalid. Please log in again.',
                    error: 'auth_session_invalid',
                    code: errorCode
                });
            }

            // Fallback for actual unexpected failures
            logger.error(`[Auth] Token Verification Failed: ${errorMsg} (${errorCode})`, {
                tokenSnippet: token?.substring(0, 15) + '...',
                env: process.env.NODE_ENV
            });

            return res.status(401).json({
                success: false,
                data: null,
                message: 'Not authorized, token failed',
                error: errorMsg,
                code: errorCode
            });
        }

        // 1. Check admins table first (Highest privilege)
        const { data: adminData } = await adminClient
            .from('admins')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        let userData = null;

        if (adminData) {
            userData = {
                role: adminData.role,
                is_email_verified: true // Admins are implicitly verified
            };
            logger.log(`[Auth] Admin role detected for ${user.email}: ${adminData.role}`);
        } else {
            // 2. Fallback to profiles table for CLIENT/FREELANCER
            const { data: profileData } = await adminClient
                .from('profiles')
                .select('role, is_email_verified')
                .eq('user_id', user.id)
                .maybeSingle();

            if (profileData) {
                userData = profileData;
            }
        }

        if (!userData) {
            // ── ONBOARDING PASS-THROUGH ──────────────────────────────────────────
            // Supabase auth passed — the user is real and authenticated. Their profile
            // row simply doesn't exist yet (e.g. new Google OAuth user). Blocking with
            // 401 here creates a permanent deadlock: they can never reach the profile-
            // wizard endpoint that CREATES the profile. Allow them through with a
            // PENDING role so syncOAuthUser / profile-wizard can complete onboarding.
            const intendedRole = user.user_metadata?.role || 'PENDING';
            logger.warn(`[Auth] Profile missing for ${user.email} (${user.id}). Allowing through with role=${intendedRole} for onboarding.`);
            userData = {
                role: intendedRole,
                is_email_verified: !!user.email_confirmed_at,
                profile_pending: true  // flag so controllers can react if needed
            };
        }

        console.log(`[Auth Debug] SUCCESS: Verified ${user.email} as ${userData.role}`);

        // --- PLATFORM ENFORCEMENT: REAL-TIME SESSION GUARD ---
        // --- PLATFORM ENFORCEMENT: REAL-TIME SESSION GUARD ---
        let statusCheck = null;
        try {
            const { data, error: statusErr } = await adminClient
                .from('profiles')
                .select('is_banned, is_restricted, ban_reason')
                .eq('user_id', user.id)
                .maybeSingle();

            if (statusErr && statusErr.code === '42703') {
                logger.warn('[Auth] Enforcement columns missing. Skipping status check.');
            } else if (statusErr) {
                throw statusErr;
            } else {
                statusCheck = data;
            }
        } catch (e) {
            logger.error('[Auth] Status check failed', e);
            // Non-blocking fallback
        }

        if (statusCheck?.is_banned) {
            logger.warn(`[Auth] Blocked request from BANNED user: ${user.email}`);
            return res.status(403).json({
                success: false,
                message: statusCheck.ban_reason || 'Your account has been permanently banned.',
                error: 'account_banned'
            });
        }




        req.user = {
            id: user.id,
            email: user.email,
            role: userData.role,
            email_confirmed: !!user.email_confirmed_at,
            user_metadata: user.user_metadata || {}
        };

        next();
    } catch (error) {
        logger.error('Auth Middleware FATAL Error:', error);
        return res.status(401).json({ success: false, data: null, message: 'Not authorized' });
    }
};

/**
 * Optional identification - does NOT throw error if no token
 * Useful for public routes that have customized views for logged-in users
 */
exports.protectOptional = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return next(); // Just continue as guest
        }

        let userRes;
        try {
            userRes = await supabase.auth.getUser(token);
        } catch (e) {
            const msg = e.message || '';
            if (msg.includes('fetch failed') || msg.includes('ENOTFOUND')) {
                logger.warn(`[Auth Middleware] Optional auth network failure: ${msg}`);
            }
            return next(); // Silently fail for network issues in optional routes
        }

        const { data: { user }, error } = userRes;

        if (error || !user) {
            const errorMsg = error?.message || 'No user found';
            if (errorMsg.includes('fetch failed') || errorMsg.includes('ENOTFOUND')) {
                logger.warn(`[Auth Middleware] Optional auth SDK network failure: ${errorMsg}`);
            }
            return next(); // Token failed/expired, but route is optional, so continue as guest
        }

        // 1. Check admins table
        const { data: adminData } = await adminClient
            .from('admins')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        let userData = null;
        if (adminData) {
            userData = { role: adminData.role };
        } else {
            // 2. Fallback to profiles table
            const { data: profileData } = await adminClient
                .from('profiles')
                .select('role')
                .eq('user_id', user.id)
                .maybeSingle();

            if (profileData) userData = profileData;
        }

        if (userData) {
            req.user = {
                id: user.id,
                email: user.email,
                role: userData.role,
                email_confirmed: !!user.email_confirmed_at
            };
        }

        next();
    } catch (error) {
        // Silently fail and continue as guest
        next();
    }
};

exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, data: null, message: 'User role not authorized to access this route' });
        }
        next();
    };
};

// Middleware to block restricted users from taking specific actions (Chat, Proposals)
exports.checkRestricted = async (req, res, next) => {
    if (!req.user) return next();

    const { data: profile } = await adminClient
        .from('profiles')
        .select('is_restricted, ban_reason')
        .eq('user_id', req.user.id)
        .single();

    if (profile?.is_restricted) {
        return res.status(403).json({
            success: false,
            message: profile.ban_reason || 'Your account is currently restricted from this action.',
            error: 'account_restricted'
        });
    }
    next();
};

// Aliases for clear route definitions
exports.clientAuth = exports.authorize(ROLES.CLIENT);
exports.freelancerAuth = exports.authorize(ROLES.FREELANCER);
exports.adminAuth = exports.authorize(...ADMIN_ROLES);

