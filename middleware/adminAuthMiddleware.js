const adminClient = require('../supabase/adminClient');
const supabase = require('../supabase/client');
const { ROLES, ADMIN_ROLES: ADMIN_ROLES_LIST } = require('../config/roles');

// Role Based Access Control (RBAC) Constants
exports.ADMIN_ROLES = ROLES;
exports.ADMIN_ROLES_LIST = ADMIN_ROLES_LIST;

exports.protectAdmin = async (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token || token === 'null' || token === 'undefined') {
            console.error('Token is missing or invalid string:', token);
            return res.status(401).json({ success: false, message: 'Not authorized: Invalid token string' });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            const errorMsg = authError?.message || 'User not found';
            console.error(`[AdminAuth] Auth Error: ${errorMsg} (Token: ${token.substring(0, 10)}...)`);
            
            if (errorMsg.includes('session missing') || errorMsg.includes('invalid') || errorMsg.includes('expired')) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Admin session expired or invalid. Please re-login.',
                    error: 'auth_session_invalid'
                });
            }
            return res.status(401).json({ success: false, message: 'Invalid session', error: errorMsg });
        }

        // Use the 'admins' table as the source of truth for RBAC
        // CRITICAL: We use adminClient (stateless/service_role) to bypass RLS and avoid session pollution
        let { data: adminRecord, error: dbError } = await adminClient
            .from('admins')
            .select('role, email')
            .eq('id', user.id)
            .maybeSingle();

        if (dbError) {
            console.error(`[AdminAuth] Database error looking up admin ${user.id}:`, dbError);
        }

        if (!adminRecord) {
            console.warn(`[AdminAuth] No admin record found for authenticated user: ${user.email} (ID: ${user.id})`);
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin record not found' });
        }

        req.user = user;
        req.adminRole = adminRecord.role;

        console.log(`[AdminAuth] Authorized: ${user.email} (Role: ${adminRecord.role})`);
        next();
    } catch (error) {
        console.error('[AdminAuth] FATAL Middleware Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error in auth' });
    }
};

exports.authorizeAdmin = (...roles) => {
    return (req, res, next) => {
        // Super Admin always has access to everything
        if (req.adminRole === exports.ADMIN_ROLES.SUPER_ADMIN) {
            return next();
        }

        if (!roles.includes(req.adminRole)) {
            console.warn(`[AdminAuth] Forbidden: ${req.user?.email} attempted to access ${req.originalUrl} without required role. Has: ${req.adminRole}, Needs: ${roles.join(' or ')}`);
            return res.status(403).json({
                success: false,
                message: `Forbidden: Your role (${req.adminRole}) does not have permission for this action.`
            });
        }
        next();
    };
};
