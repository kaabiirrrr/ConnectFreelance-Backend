const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const { ADMIN_ROLES } = require('../../middleware/adminAuthMiddleware');

/**
 * List all admins (Super Admin only)
 */
exports.getAllAdmins = async (req, res, next) => {
    try {
        const { data: admins, error } = await supabase
            .from('admins')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: admins
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Add a new admin (Super Admin only)
 */
exports.addAdmin = async (req, res, next) => {
    try {
        const { email, role, password } = req.body;

        if (!email || !role) {
            return res.status(400).json({ success: false, message: 'Email and role are required' });
        }

        if (!Object.values(ADMIN_ROLES).includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        if (password && password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters long' 
            });
        }

        // 1. Manage user in authentication system
        const { data: { users }, error: authSearchError } = await supabase.auth.admin.listUsers();
        if (authSearchError) throw authSearchError;

        let targetUser = users.find(u => u.email === email);
        let userId;

        if (targetUser) {
            userId = targetUser.id;
            // Update password if provided
            if (password) {
                const { error: updateAuthError } = await supabase.auth.admin.updateUserById(userId, { password });
                if (updateAuthError) throw updateAuthError;
            }
        } else {
            // Create user if they don't exist
            if (!password) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'User not found. A password is required to create a new admin account.' 
                });
            }

            const { data: { user: newUser }, error: createAuthError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name: email.split('@')[0] }
            });

            if (createAuthError) throw createAuthError;
            userId = newUser.id;
            targetUser = newUser;
        }

        // 2. Add or Update in admins table
        const { data: existingAdmin } = await supabase
            .from('admins')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

        let adminData;
        if (existingAdmin) {
            // If already an admin, just update role and log
            const { data: updatedAdmin, error: updateError } = await supabase
                .from('admins')
                .update({ 
                    role, 
                    email: targetUser.email,
                    must_change_password: password ? true : false // Set flag if password was reset
                })
                .eq('id', userId)
                .select()
                .single();
            
            if (updateError) throw updateError;
            adminData = updatedAdmin;
        } else {
            const { data: newAdmin, error: insertError } = await supabase
                .from('admins')
                .insert({
                    id: userId,
                    email: targetUser.email,
                    role: role,
                    name: targetUser.user_metadata?.full_name || email.split('@')[0],
                    must_change_password: true // Always true for new admins created this way
                })
                .select()
                .single();

            if (insertError) throw insertError;
            adminData = newAdmin;
        }

        // 3. Log action
        await logAction(
            req.user.id,
            'ADMIN_ADD',
            adminData.id,
            `Added/Updated admin: ${email} with role ${role}`
        );

        res.status(201).json({
            success: true,
            message: existingAdmin ? 'Admin credentials and role updated' : 'New admin created successfully',
            data: adminData
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Remove an admin (Super Admin only)
 */
exports.removeAdmin = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Prevent self-removal
        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot remove yourself' });
        }

        // Check if admin exists
        const { data: admin, error: fetchError } = await supabase
            .from('admins')
            .select('email')
            .eq('id', id)
            .single();

        if (fetchError || !admin) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }

        // Delete from admins table
        const { error: deleteError } = await supabase
            .from('admins')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        // Log action
        await logAction(
            req.user.id,
            'ADMIN_REMOVE',
            id,
            `Removed admin: ${admin.email}`
        );

        res.status(200).json({
            success: true,
            message: 'Admin removed successfully'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Change admin role (Super Admin only)
 */
exports.updateAdminRole = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role || !Object.values(ADMIN_ROLES).includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        // Prevent self-role-change (to avoid losing Super Admin status accidentally)
        if (id === req.user.id && role !== ADMIN_ROLES.SUPER_ADMIN) {
            return res.status(400).json({ success: false, message: 'You cannot downgrade your own role' });
        }

        const { data: updatedAdmin, error } = await supabase
            .from('admins')
            .update({ role })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Log action
        await logAction(
            req.user.id,
            'ADMIN_ROLE_CHANGE',
            id,
            `Changed admin role for ${updatedAdmin.email} to ${role}`
        );

        res.status(200).json({
            success: true,
            message: 'Admin role updated successfully',
            data: updatedAdmin
        });
    } catch (error) {
        next(error);
    }
};
