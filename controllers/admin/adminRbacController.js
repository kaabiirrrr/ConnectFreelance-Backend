const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

/**
 * Fetch all available granular permissions
 */
exports.getAllPermissions = async (req, res, next) => {
    try {
        const { data: permissions, error } = await supabase
            .from('admin_permissions')
            .select('*')
            .order('module', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: permissions
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Fetch all roles with their associated permissions
 */
exports.getAllRoles = async (req, res, next) => {
    try {
        const { data: roles, error } = await supabase
            .from('admin_roles')
            .select(`
                *,
                admin_role_permissions (
                    admin_permissions (*)
                )
            `)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Transform data into a cleaner frontend format
        const formattedRoles = roles.map(role => {
            const permissions = role.admin_role_permissions.map(
                rp => `${rp.admin_permissions.module}:${rp.admin_permissions.action}`
            );
            
            return {
                id: role.id,
                name: role.name,
                description: role.description,
                isSystem: role.is_system,
                risk: role.risk_level,
                permissions: permissions
            };
        });

        res.status(200).json({
            success: true,
            data: formattedRoles
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Fetch Admin Activity Logs (Immutable Ledger)
 */
exports.getAuditLogs = async (req, res, next) => {
    try {
        const { data: logs, error } = await supabase
            .from('admin_activity_logs')
            .select(`
                *,
                admins ( email, name )
            `)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: logs
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update a role's permissions
 */
exports.updateRolePermissions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body; // Array of strings like "module:action"

        if (!id) return res.status(400).json({ success: false, message: 'Role ID is required' });
        if (!Array.isArray(permissions)) return res.status(400).json({ success: false, message: 'Permissions must be an array' });

        // 1. Fetch all permissions to map "module:action" to their UUIDs
        const { data: allPerms, error: fetchError } = await supabase
            .from('admin_permissions')
            .select('*');
            
        if (fetchError) throw fetchError;

        const permIdMap = {};
        allPerms.forEach(p => {
            permIdMap[`${p.module}:${p.action}`] = p.id;
        });

        // Resolve requested permissions to IDs
        const permissionIdsToInsert = permissions
            .filter(p => permIdMap[p])
            .map(p => ({
                role_id: id,
                permission_id: permIdMap[p]
            }));

        // 2. Delete existing permissions for this role
        const { error: deleteError } = await supabase
            .from('admin_role_permissions')
            .delete()
            .eq('role_id', id);

        if (deleteError) throw deleteError;

        // 3. Insert new permissions if any
        if (permissionIdsToInsert.length > 0) {
            const { error: insertError } = await supabase
                .from('admin_role_permissions')
                .insert(permissionIdsToInsert);

            if (insertError) throw insertError;
        }

        // 4. Log the action
        await logAction(
            req.admin?.id,
            'UPDATE_ROLE_PERMISSIONS',
            'admin_roles',
            id,
            req,
            { updated_permissions: permissions }
        );

        res.status(200).json({
            success: true,
            message: 'Role permissions updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

