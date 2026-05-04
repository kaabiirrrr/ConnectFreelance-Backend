const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

exports.getAllUsers = async (req, res, next) => {
    try {
        const { role, limit = 50, offset = 0, search = '' } = req.query;

        // 1. Fetch users from public profiles table
        let query = supabase
            .from('profiles')
            .select('*', { count: 'exact' });

        if (role) {
            query = query.eq('role', role.toUpperCase());
        }

        if (search) {
            query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
        }

        const { data: dbUsers, count, error: dbError } = await query
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (dbError) throw dbError;

        // 2. Fetch Auth data to get last_sign_in_at and account status
        // Note: listUsers is paginated but for admin dashboard we usually need to merge
        // A more efficient way in production would be to sync last_login to public.users via triggers
        const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
        if (authError) {
            logger.error('Error fetching Auth users', authError);
        }

        const authUsersMap = new Map();
        if (authData?.users) {
            authData.users.forEach(u => authUsersMap.set(u.id, u));
        }

        // 3. Merge data
        const mergedUsers = dbUsers.map(user => {
            const authUser = authUsersMap.get(user.user_id || user.id);

            // --- Compute profile_completion_percentage for CLIENT users ---
            // Clients use is_client_profile_complete (boolean) and don't go through
            // the freelancer wizard that sets profile_completion_percentage.
            let profileCompletionPercentage = user.profile_completion_percentage || 0;
            if (user.role === 'CLIENT') {
                if (user.is_client_profile_complete) {
                    profileCompletionPercentage = 100;
                } else {
                    // Score from filled fields (each worth 20%)
                    let score = 0;
                    if (user.name) score += 20;
                    if (user.avatar_url) score += 20;
                    if (user.title || user.company_name) score += 20;
                    if (user.bio) score += 20;
                    if (user.country || user.city || user.location) score += 20;
                    profileCompletionPercentage = score;
                }
            }

            const enrichedProfile = {
                ...user,
                profile_completion_percentage: profileCompletionPercentage
            };

            return {
                ...user,
                id: user.user_id || user.id,
                profile: enrichedProfile,
                profile_completion_percentage: profileCompletionPercentage,
                last_login: authUser?.last_sign_in_at || null,
                is_banned: !!authUser?.banned_until && new Date(authUser.banned_until) > new Date(),
                email_confirmed: !!authUser?.email_confirmed_at
            };
        });

        res.status(200).json({
            success: true,
            data: mergedUsers,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.verifyUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('profiles')
            .update({ is_verified: true })
            .eq('user_id', id);

        if (error) throw error;

        await logAction(req.user.id, 'USER_VERIFY', id, `Verified user ID: ${id}`);

        res.status(200).json({ success: true, message: 'User verified successfully' });
    } catch (error) {
        next(error);
    }
};

const banUser = async (userId, isBanned, adminId) => {
    // Ban for 100 years or unban
    const banDuration = isBanned ? '876000h' : '0h';

    const { error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: banDuration
    });

    if (error) {
        logger.error('Supabase Admin API error', error);
        throw error;
    }

    // --- BANKING HARDENING: REAL-TIME SESSION KILL FLAG ---
    if (isBanned) {
        await supabase.from('violations').insert([{
            user_id: userId,
            reason: 'Account banned by administrator',
            severity: 'BAN',
            status: 'ACTIVE'
        }]);
    } else {
        await supabase.from('violations')
            .update({ status: 'RESOLVED' })
            .eq('user_id', userId)
            .eq('severity', 'BAN');
    }

    if (adminId) {
        await logAction(adminId, isBanned ? 'USER_BAN' : 'USER_ACTIVATE', userId, `${isBanned ? 'Banned' : 'Activated'} user ID: ${userId}`);
    }


    return true;
};

exports.banUser = banUser;

exports.toggleUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { is_banned } = req.body;
        await banUser(id, is_banned, req.user.id);

        res.status(200).json({
            success: true,
            message: `User ${is_banned ? 'disabled' : 'enabled'} successfully`
        });
    } catch (error) {
        logger.error('Error in toggleUserStatus controller', error);
        next(error);
    }
};

exports.resetUserPassword = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 1. Get user email
        const { data: user, error: userError } = await supabase
            .from('profiles')
            .select('email')
            .eq('user_id', id)
            .single();

        if (userError || !user) throw new Error('User not found');

        // 2. Generate recovery link (Supabase sends the email automatically if configured)
        const { error } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: user.email,
            options: {
                redirectTo: `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password`
            }
        });

        if (error) throw error;

        await logAction(req.user.id, 'USER_PASSWORD_RESET', id, `Requested password reset for user ID: ${id}`);

        res.status(200).json({
            success: true,
            message: 'Password reset link sent to user email'
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Delete from Auth (Cascade will handle public.users and profiles)
        const { error } = await supabase.auth.admin.deleteUser(id);

        if (error) throw error;

        await logAction(req.user.id, 'USER_DELETE', id, `Deleted user ID: ${id}`);

        res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        next(error);
    }
};

exports.createUser = async (req, res, next) => {
    try {
        const { email, password, name, role } = req.body;

        if (!email || !password || !name || !role) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // 1. Create user in Auth
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name, role: role.toUpperCase() }
        });

        if (authError) throw authError;

        // 2. Create profile in public.profiles (if trigger didn't handle it or to be safe)
        // Check if profile exists
        const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', authUser.user.id)
            .single();

        if (!existingProfile) {
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{
                    user_id: authUser.user.id,
                    email,
                    name,
                    role: role.toUpperCase(),
                    is_verified: true // Admin created users are verified by default
                }]);
            
            if (profileError) {
                // Cleanup auth user if profile creation fails
                await supabase.auth.admin.deleteUser(authUser.user.id);
                throw profileError;
            }
        }

        await logAction(req.user.id, 'USER_CREATE', authUser.user.id, `Created new ${role} user: ${email}`);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: authUser.user
        });
    } catch (error) {
        next(error);
    }
};
