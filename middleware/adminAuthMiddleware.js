const adminClient = require('../supabase/adminClient');
const supabase = require('../supabase/client');
const { ROLES, ADMIN_ROLES: ADMIN_ROLES_LIST } = require('../config/roles');

exports.ADMIN_ROLES = ROLES;
exports.ADMIN_ROLES_LIST = ADMIN_ROLES_LIST;

exports.protectAdmin = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token || token === 'null' || token === 'undefined') {
            return res.status(401).json({ success: false, message: 'Not authorized: Invalid token string' });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Admin session expired or invalid. Please re-login.',
                error: authError?.message || 'User not found'
            });
        }

        // Fetch admin along with their dynamic roles and permissions
        // Note: Supabase JS joins syntax:
        const { data: adminRecord, error: dbError } = await adminClient
            .from('admins')
            .select(`
                id, role, email, trust_score, risk_score, mfa_enforced,
                admin_user_roles!admin_user_roles_admin_id_fkey(
                    admin_roles(
                        name,
                        admin_role_permissions(
                            admin_permissions(module, action)
                        )
                    )
                )
            `)
            .eq('id', user.id)
            .maybeSingle();

        if (dbError) {
            console.error(`[AdminAuth] DB error for admin ${user.id}:`, dbError);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (!adminRecord) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin record not found' });
        }

        // Flatten permissions for easy checking
        const permissions = new Set();
        let isSuperAdmin = adminRecord.role === 'SUPER_ADMIN'; // Legacy support

        if (adminRecord.admin_user_roles) {
            adminRecord.admin_user_roles.forEach(ur => {
                if (ur.admin_roles) {
                    if (ur.admin_roles.name === 'Super Admin') isSuperAdmin = true;
                    if (ur.admin_roles.admin_role_permissions) {
                        ur.admin_roles.admin_role_permissions.forEach(rp => {
                            if (rp.admin_permissions) {
                                permissions.add(`${rp.admin_permissions.module}:${rp.admin_permissions.action}`);
                            }
                        });
                    }
                }
            });
        }

        req.user = user;
        req.adminRecord = adminRecord;
        req.adminRole = adminRecord.role; // Legacy
        req.isSuperAdmin = isSuperAdmin;
        req.adminPermissions = permissions;

        next();
    } catch (error) {
        console.error('[AdminAuth] FATAL Middleware Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error in auth' });
    }
};

// Legacy Authorize (kept for backward compatibility during transition)
exports.authorizeAdmin = (...roles) => {
    return (req, res, next) => {
        if (req.isSuperAdmin) return next();
        if (!roles.includes(req.adminRole)) {
            return res.status(403).json({ success: false, message: `Forbidden: Your role does not have permission.` });
        }
        next();
    };
};

// New RBAC Authorize
exports.requirePermission = (moduleName, actionName) => {
    return (req, res, next) => {
        if (req.isSuperAdmin) {
            return next(); // Super Admins bypass checks
        }

        const requiredPerm = `${moduleName}:${actionName}`;
        if (!req.adminPermissions.has(requiredPerm)) {
            console.warn(`[RBAC] Access Denied: Admin ${req.user.email} missing permission ${requiredPerm}`);
            // Log 403 failure for security monitoring
            adminClient.from('admin_activity_logs').insert({
                admin_id: req.user.id,
                action: `403_FORBIDDEN_${requiredPerm}`,
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                metadata: { path: req.originalUrl }
            }).then(); // Fire and forget

            return res.status(403).json({
                success: false,
                message: 'Forbidden: You do not have the required permission.',
                missing_permission: requiredPerm
            });
        }
        next();
    };
};

// Dynamic Policy Engine Stub
exports.requirePolicy = (policyRule) => {
    return async (req, res, next) => {
        // Evaluate dynamic conditions (e.g. IF refund > 50k THEN dual approval)
        // This is highly specific to the endpoint
        console.log(`[PolicyEngine] Evaluating rule: ${policyRule.name}`);
        
        try {
            const passed = await policyRule.evaluate(req);
            if (!passed) {
                return res.status(403).json({
                    success: false,
                    message: `Policy enforcement failed: ${policyRule.errorMessage}`
                });
            }
            next();
        } catch (error) {
            console.error('[PolicyEngine] Error:', error);
            res.status(500).json({ success: false, message: 'Policy evaluation failed' });
        }
    };
};

// Immutable Audit Logging
exports.logAdminActivity = (actionName, getEntityType = () => null, getEntityId = () => null) => {
    return (req, res, next) => {
        res.on('finish', async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const entityType = typeof getEntityType === 'function' ? getEntityType(req) : getEntityType;
                const entityId = typeof getEntityId === 'function' ? getEntityId(req) : getEntityId;
                
                await adminClient.from('admin_activity_logs').insert({
                     admin_id: req.user.id,
                     action: actionName,
                     entity_type: entityType,
                     entity_id: entityId,
                     ip_address: req.ip,
                     user_agent: req.get('user-agent'),
                     metadata: { path: req.originalUrl, method: req.method }
                });
            }
        });
        next();
    };
};
