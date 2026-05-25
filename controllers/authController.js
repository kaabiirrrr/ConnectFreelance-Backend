const adminClient = require('../supabase/adminClient');
const supabase = require('../supabase/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationLinkEmail, sendPasswordResetEmail } = require('../utils/emailService');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');
const TrustGraphService = require('../services/TrustGraphService');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const generateVerificationToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

exports.register = async (req, res, next) => {
    try {
        const { email, password, role, name } = req.body;

        if (!email || !password || !role || !name) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        // 1. Create confirmed auth user via Supabase Admin API
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: false, // Restored for production security
            user_metadata: { full_name: name, role }
        });

        if (authError) {
            const msg = authError.message?.toLowerCase() || '';
            const isEmailExists =
                msg.includes('already registered') ||
                msg.includes('already exists') ||
                msg.includes('email address is already') ||
                authError.status === 422;

            if (isEmailExists) {
                // Check if this is an "orphaned" user — exists in Auth but not in profiles
                const { data: existingUsers } = await adminClient.auth.admin.listUsers();
                const existingAuthUser = existingUsers?.users?.find(u => u.email === email);

                if (existingAuthUser) {
                    // Check if a profile exists for them
                    const { data: existingProfile } = await adminClient
                        .from('profiles')
                        .select('user_id')
                        .eq('user_id', existingAuthUser.id)
                        .maybeSingle();

                    if (!existingProfile) {
                        // ORPHANED USER: Auth entry exists but no profile — complete the registration
                        logger.log(`[Register] Orphaned user detected (${email}). Completing profile setup.`);
                        // Fall through to use this existing auth user
                        const user = existingAuthUser;

                        // Insert into public.users if missing
                        await adminClient.from('users').upsert([{ id: user.id, email, role }], { onConflict: 'id' });

                        const verificationToken = generateVerificationToken();
                        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

                        await adminClient.from('profiles').insert([{
                            user_id: user.id, email, name, role,
                            is_email_verified: false,
                            email_token: verificationToken,
                            otp_expires_at: expires
                        }]);

                        if (process.env.ESCROW_MODE === 'FAKE') {
                            try {
                                await adminClient.from('wallets')
                                    .upsert([{ user_id: user.id, available_balance: 10000, pending_balance: 0 }], { onConflict: 'user_id' });
                            } catch (err) {
                                logger.error('[Register] Demo wallet seeding failed', err);
                            }
                        }

                        try {
                            const backendUrl = process.env.NODE_ENV === 'development' 
                                ? `http://localhost:${process.env.PORT || 5001}` 
                                : (process.env.BACKEND_URL || 'https://connect-backend-1-dm8d.onrender.com');
                            const verifyLink = `${backendUrl}/api/auth/verify-email?token=${verificationToken}&uid=${user.id}`;
                            await sendVerificationLinkEmail(email, verifyLink, name || email.split('@')[0]);
                        } catch (emailErr) {
                            logger.error('[Register] Failed to send verification email to orphaned user:', emailErr.message);
                        }

                        return res.status(201).json({
                            success: true,
                            message: 'Registration successful! Please check your email to verify your account.',
                            data: { user: { id: user.id, email: user.email, name, role } }
                        });
                    }
                }

                // Profile exists — genuinely already registered
                return res.status(409).json({
                    success: false,
                    message: 'An account with this email already exists. Please log in instead.'
                });
            }
            throw authError;
        }

        const user = authData.user;
        if (!user) throw new Error('User creation failed');

        // 2. Insert into public.users (Intermediate table required by foreign keys)
        const { error: userError } = await adminClient
            .from('users')
            .insert([{
                id: user.id,
                email: email,
                role: role
            }]);

        if (userError) {
            logger.error('[Register] public.users creation error:', userError);
        }

        // 3. Generate Verification Token
        const verificationToken = generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // 4. Create profile with verification details
        const { error: profileError } = await adminClient
            .from('profiles')
            .insert([{
                user_id: user.id,
                email: email,
                name: name,
                role: role,
                is_email_verified: false,
                email_token: verificationToken,
                otp_expires_at: expires
            }]);

        if (profileError) {
            logger.error('[Register] Profile creation error:', profileError);
        } else {
            // 4.1 Seed Wallet (Demo Mode)
            if (process.env.ESCROW_MODE === 'FAKE') {
                try {
                    await adminClient
                        .from('wallets')
                        .insert([{ user_id: user.id, available_balance: 10000, pending_balance: 0 }]);
                } catch (err) {
                    logger.error('[Register] Demo wallet seeding failed', err);
                }
            }

            // 5. Send Verification Email
            try {
                const backendUrl = process.env.NODE_ENV === 'development' 
                    ? `http://localhost:${process.env.PORT || 5001}` 
                    : (process.env.BACKEND_URL || 'https://connect-backend-1-dm8d.onrender.com');
                const verifyLink = `${backendUrl}/api/auth/verify-email?token=${verificationToken}&uid=${user.id}`;
                await sendVerificationLinkEmail(email, verifyLink, name || email.split('@')[0]);
                logger.log(`[Register] Verification email sent to ${email}`);
            } catch (emailErr) {
                logger.error('[Register] Failed to send verification email:', emailErr.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email to verify your account.',
            data: { user: { id: user.id, email: user.email, name, role } }
        });

        // Background: Update behavioral signals
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        TrustGraphService.updateSignals(user.id, { ip });

    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    const traceId = Math.random().toString(36).substring(7);
    logger.log(`[Login][${traceId}] Starting login for: ${req.body.email}`);
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        // 1. Supabase Auth Sign In
        let authData, authError;
        try {
            const res = await supabase.auth.signInWithPassword({ email, password });
            authData = res.data;
            authError = res.error;
        } catch (fetchErr) {
            const msg = fetchErr.message || '';
            if (msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
                logger.error(`[Login][${traceId}] CRITICAL NETWORK FAILURE TO SECURITY SERVER: ${msg}`);
                return res.status(503).json({ 
                    success: false, 
                    message: 'Security server unreachable (Gateway Error). Please check your internet or VPN.',
                    isNetworkError: true
                });
            }
            throw fetchErr;
        }
          
        if (authError || !authData?.user) {
            const errorMsg = authError?.message || '';
            
            // SDK-level network failure check (if not caught by try/catch)
            if (errorMsg.includes('fetch failed') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('EAI_AGAIN')) {
                 logger.error(`[Login][${traceId}] SDK-LEVEL NETWORK FAILURE: ${errorMsg}`);
                 return res.status(503).json({ 
                     success: false, 
                     message: 'Security server unreachable (SDK Gateway Error). Please check your internet or VPN.',
                     isNetworkError: true
                 });
            }

            logger.warn(`[Login][${traceId}] Auth error:`, authError);
            return res.status(401).json({ success: false, message: authError?.message || 'Invalid credentials' });
        }

        const userId = authData.user.id;
        const userEmail = authData.user.email;

        // 2. Role detection (Super Admin -> Admin DB -> Profile)
        let role = null;
        let isAdminRole = false;
        const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;

        if (SUPER_ADMIN_EMAIL && userEmail.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
            logger.log(`[Login][${traceId}] 🚨 SUPER ADMIN detected via env`);
            role = 'SUPER_ADMIN';
            isAdminRole = true;
        } else {
            const { data: adminData } = await adminClient
                .from('admins')
                .select('role')
                .eq('id', userId)
                .maybeSingle();

            if (adminData) {
                role = adminData.role;
                isAdminRole = true;
                logger.log(`[Login][${traceId}] Admin detected: ${role}`);
            }
        }

        // 3. Profile Lookup & Creation
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
            .eq('user_id', userId)
            .maybeSingle();

        let finalProfile = profile;
        const isEmailVerifiedInAuth = !!authData.user.email_confirmed_at;

        if (!profile) {
            logger.log(`[Login][${traceId}] Profile missing. Syncing...`);
            
            // 3.1 Ensure record in public.users exists (Intermediate table)
            const { error: userSyncError } = await adminClient
                .from('users')
                .upsert([{ 
                    id: userId, 
                    email: userEmail, 
                    role: role || authData.user.user_metadata?.role || 'CLIENT'
                }]);
            
            if (userSyncError) {
                logger.error(`[Login][${traceId}] public.users sync error:`, userSyncError);
                throw userSyncError;
            }

            const { data: newProfile, error: syncError } = await adminClient
                .from('profiles')
                .upsert([{ 
                    user_id: userId, 
                    email: userEmail, 
                    name: authData.user.user_metadata?.full_name || userEmail.split('@')[0],
                    role: role || authData.user.user_metadata?.role || 'CLIENT', // Default to CLIENT if no role found
                    is_email_verified: isEmailVerifiedInAuth
                }])
                .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
                .single();
            
            if (syncError) throw syncError;
            finalProfile = newProfile;
            if (!role) role = finalProfile.role;
        } else {
            if (!role) role = profile.role;
            isAdminRole = isAdminRole || ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(role);
            
            // Background sync email verified status if out of sync
            if (isEmailVerifiedInAuth && !profile.is_email_verified) {
                adminClient.from('profiles').update({ is_email_verified: true }).eq('user_id', userId).then(() => {});
            }
        }

        const profileCompleted = finalProfile.profile_completed || finalProfile.profile_completion_percentage >= 100;

        // 4. Membership Lookup (Aligned with Master Economy Schema)
        const { data: membership } = await adminClient
            .from('memberships')
            .select('plan_id, status, end_date, plan_snapshot, plan:membership_plans(name)')
            .eq('user_id', userId)
            .eq('status', 'ACTIVE')
            .maybeSingle();

        res.status(200).json({
            success: true,
            data: {
                user: { 
                    id: userId, 
                    email: userEmail, 
                    full_name: finalProfile.name, 
                    role, 
                    profile: { ...finalProfile, membership },
                    is_profile_complete: profileCompleted,
                    is_client_profile_complete: finalProfile.is_client_profile_complete
                },
                session: authData.session,
                role,
                isAdmin: isAdminRole,
                profileCompleted,
                membership // Include at top level too for easy access
            },
            message: 'Login successful'
        });

        // Background: Update behavioral signals
        const { deviceId } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        TrustGraphService.updateSignals(userId, { deviceId, ip });

    } catch (error) {
        logger.error(`[Login][${traceId}] FATAL:`, error);
        next(error);
    }
};

/**
 * Mark the authenticated user's email as verified in our profiles table.
 */
exports.markEmailVerified = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { error: updateError } = await adminClient
            .from('profiles')
            .update({ is_email_verified: true })
            .eq('user_id', userId);

        if (updateError) throw updateError;

        logger.log(`[markEmailVerified] Email marked as verified for user: ${userId}`);
        res.status(200).json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        next(error);
    }
};

exports.sendVerification = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }
        const authToken = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);

        if (authError || !user) return res.status(401).json({ success: false, message: 'Invalid token' });

        const userId = user.id;
        const email = user.email;
        const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;

        logger.log(`[sendVerification] Processing for: ${email}`);

        let role = null;
        let isAdmin = false;

        // 1. Super Admin detection
        if (SUPER_ADMIN_EMAIL && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
            role = 'SUPER_ADMIN';
            isAdmin = true;
        } else {
            // 2. Admin DB Check
            const { data: adminRecord } = await adminClient
                .from('admins')
                .select('role')
                .eq('id', userId)
                .maybeSingle();

            if (adminRecord) {
                role = adminRecord.role;
                isAdmin = true;
            } else {
                const { data: adminByEmail } = await adminClient
                    .from('admins')
                    .select('role')
                    .ilike('email', email.trim())
                    .maybeSingle();

                if (adminByEmail) {
                    role = adminByEmail.role;
                    isAdmin = true;
                }
            }
        }

        // 3. Profile Lookup
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('id:user_id, user_id, email, name, role, is_email_verified')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileError) throw profileError;
        if (!profile) return res.status(404).json({ success: false, message: 'User profile not found' });

        if (profile.is_email_verified) {
            return res.status(400).json({ success: false, message: 'Email is already verified' });
        }

        // 4. Generate & Save New Verification Token
        const verificationToken = generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const { data: updatedProfile, error: updateError } = await adminClient
            .from('profiles')
            .update({ 
                email_token: verificationToken, 
                otp_expires_at: expires 
            })
            .eq('user_id', userId)
            .select('id:user_id, user_id, email, name, role, is_email_verified, is_client_profile_complete')
            .single();

        if (updateError) throw updateError;

        // 5. Send Email
        const verifyLink = `${process.env.BACKEND_URL || 'https://connect-backend-1-varc.onrender.com'}/api/auth/verify-email?token=${verificationToken}&uid=${userId}`;
        await sendVerificationLinkEmail(email, verifyLink, updatedProfile.name || email.split('@')[0], true);

        res.status(200).json({
            success: true,
            message: 'Verification email sent successfully',
            data: { 
                email, 
                is_admin: isAdmin,
                role: role || profile.role
            }
        });

    } catch (error) {
        logger.error('[sendVerification] Error:', error);
        next(error);
    }
};

exports.verifyEmail = async (req, res, next) => {
    const { token, uid } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'https://connectfreelance.in';

    try {
        if (!token || !uid) {
            return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        }

        const { data: profile, error: fetchError } = await adminClient
            .from('profiles')
            .select('email, email_token, otp_expires_at, is_email_verified')
            .eq('user_id', uid)
            .maybeSingle();

        if (fetchError || !profile) {
            return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        }

        if (profile.is_email_verified) {
            return res.redirect(`${frontendUrl}/login?verified=true&email=${encodeURIComponent(profile.email)}&status=already_verified`);
        }

        if (profile.email_token !== token) {
            return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        }

        if (new Date(profile.otp_expires_at) < new Date()) {
            return res.redirect(`${frontendUrl}/verify-email?status=expired`);
        }

        const { error: updateError } = await adminClient
            .from('profiles')
            .update({ 
                is_email_verified: true, 
                email_token: null, 
                otp_expires_at: null,
                email_otp: null
            })
            .eq('user_id', uid);

        if (updateError) throw updateError;

        // 3. Sync with Supabase Auth (Confirm user in auth.users)
        try {
            const { error: authConfirmError } = await adminClient.auth.admin.updateUserById(uid, { 
                email_confirm: true 
            });
            if (authConfirmError) {
                logger.error(`[VerifyEmail] Auth confirm error for ${uid}:`, authConfirmError);
            } else {
                logger.log(`[VerifyEmail] Supabase Auth confirmed for ${uid}`);
            }
        } catch (authErr) {
            logger.error(`[VerifyEmail] Auth sync exception for ${uid}:`, authErr);
        }

        // 4. Auto-login: Generate a magic link so the user skips the login page
        // This link auto signs them in and redirects to /auth/callback
        // AuthCallback will then route them to /profile-wizard automatically
        try {
            const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
                type: 'magiclink',
                email: profile.email,
                options: {
                    redirectTo: `${frontendUrl}/auth/callback`
                }
            });

            if (!linkError && linkData?.properties?.action_link) {
                logger.log(`[VerifyEmail] Auto-login magic link generated for ${profile.email}`);
                return res.redirect(linkData.properties.action_link);
            } else {
                logger.error('[VerifyEmail] Magic link generation failed, falling back to login:', linkError);
            }
        } catch (magicLinkErr) {
            logger.error('[VerifyEmail] Magic link exception, falling back to login:', magicLinkErr);
        }

        // Fallback: if magic link fails, redirect to login with verified flag
        return res.redirect(`${frontendUrl}/login?verified=true&email=${encodeURIComponent(profile.email)}`);

    } catch (error) {
        logger.error('[VerifyEmail] Error:', error);
        return res.redirect(`${frontendUrl}/verify-email?status=error`);
    }
};


exports.logout = async (req, res, next) => {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        logger.info('User logged out successfully');
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        logger.error('Logout error', error);
        next(error);
    }
};

exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const frontendUrl = process.env.FRONTEND_URL || 'https://connectfreelance.in';

        // Use Admin API to generate a highly-secure recovery link without triggering Supabase's default email
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
            type: 'recovery',
            email: email,
            options: {
                redirectTo: `${frontendUrl}/reset-password`
            }
        });

        if (linkError) {
            // Log the error but don't leak enumeration to the client
            logger.error('[ForgotPassword] Error generating recovery link:', linkError.message);
        } else if (linkData?.properties?.action_link) {
            // Fetch user's name to personalize the email
            let name = email.split('@')[0];
            try {
                const { data: profile } = await adminClient.from('profiles').select('name').eq('email', email).maybeSingle();
                if (profile && profile.name) name = profile.name;
            } catch (err) {
                logger.warn('[ForgotPassword] Failed to fetch profile name:', err.message);
            }

            // Send our beautifully branded custom email via Resend
            await sendPasswordResetEmail(email, linkData.properties.action_link, name);
            logger.info(`[ForgotPassword] Sent password reset email to ${email}`);
        }

        // Always return success to prevent email enumeration
        res.status(200).json({ success: true, message: 'If an account exists, a password reset link has been sent.' });
    } catch (error) {
        logger.error('[ForgotPassword] FATAL:', error);
        next(error);
    }
};

exports.resetPassword = async (req, res, next) => {
    try {
        const { password } = req.body;
        const { error } = await supabase.auth.updateUser({ password });
        
        if (error) throw error;
        
        logger.info('Password reset successful');
        res.status(200).json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
        logger.error('Reset password error', error);
        next(error);
    }
};

exports.googleLogin = async (req, res, next) => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${process.env.FRONTEND_URL || 'https://connectfreelance.in'}/auth/callback`
            }
        });

        if (error) throw error;
        if (data?.url) return res.redirect(data.url);
        
        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('Google login error', error);
        next(error);
    }
};

exports.appleLogin = async (req, res, next) => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: `${process.env.FRONTEND_URL || 'https://connectfreelance.in'}/auth/callback`
            }
        });

        if (error) throw error;
        if (data?.url) return res.redirect(data.url);
        
        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('Apple login error', error);
        next(error);
    }
};

exports.facebookLogin = async (req, res, next) => {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'facebook',
            options: {
                redirectTo: `${process.env.FRONTEND_URL || 'https://connectfreelance.in'}/auth/callback`
            }
        });

        if (error) throw error;
        if (data?.url) return res.redirect(data.url);
        
        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('Facebook login error', error);
        next(error);
    }
};

exports.syncOAuthUser = async (req, res, next) => {
    try {
        const user = req.user; 
        const { role: intendedRole } = req.body; 
        
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        // 1. Check if they are an admin — authoritative role
        const { data: adminRecord } = await adminClient
            .from('admins')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        let { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
            .eq('user_id', user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        const authoritativeRole = adminRecord ? adminRecord.role : (intendedRole || user.user_metadata?.role || profile?.role || null);

        if (!profile) {
            logger.log(`[SyncOAuth] Creating profile for user: ${user.email} (Role: ${authoritativeRole || 'PENDING'})`);
            
            // 1.1 Ensure record in public.users exists (Intermediate table required by FK)
            const { error: userSyncError } = await adminClient
                .from('users')
                .upsert([{ 
                    id: user.id, 
                    email: user.email, 
                    role: authoritativeRole || user.user_metadata?.role || 'CLIENT'
                }]);

            if (userSyncError) {
                logger.error('[SyncOAuth] public.users sync error:', userSyncError);
                // Continue anyway, maybe it exists but fetch failed? Actually no, better to fail fast or log.
            }

            const profileData = {
                user_id: user.id,
                email: user.email,
                name: user.user_metadata?.full_name || user.email.split('@')[0],
                is_email_verified: true
            };

            // Only add role if we have a valid one
            if (authoritativeRole) {
                profileData.role = authoritativeRole;
            }

            const { data: newProfile, error: createError } = await adminClient
                .from('profiles')
                .upsert([profileData])
                .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
                .single();

            if (createError) {
                logger.error('[SyncOAuth] Profile creation failed:', createError);
                throw createError;
            }
            profile = newProfile;
        } else if (authoritativeRole && profile.role !== authoritativeRole) {
            logger.log(`[SyncOAuth] Role mismatch for ${user.email}. Updating ${profile.role} -> ${authoritativeRole}`);
            
            // 1. Update Profile (Triggers DB-level sync to public.users)
            const { data: updatedProfile } = await adminClient
                .from('profiles')
                .update({ role: authoritativeRole })
                .eq('user_id', user.id)
                .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
                .single();
            profile = updatedProfile;

            // 2. Sync with Auth metadata
            await adminClient.auth.admin.updateUserById(user.id, {
                user_metadata: { ...user.user_metadata, role: authoritativeRole }
            });
        }

        // 3. Fetch Membership (Consistency check for BuyConnects / Pro status)
        const { data: membership } = await adminClient
            .from('memberships')
            .select('plan_id, status, end_date, plan_snapshot, plan:membership_plans(name)')
            .eq('user_id', user.id)
            .eq('status', 'ACTIVE')
            .maybeSingle();

        // Return structure for AuthContext.jsx lines 56-61
        res.status(200).json({
            success: true,
            data: { 
                role: profile.role, 
                profile: { ...profile, membership },
                membership
            }
        });
    } catch (error) {
        logger.error('[SyncOAuth] Error:', error);
        next(error);
    }
};

exports.updateRole = async (req, res, next) => {
    try {
        const { role } = req.body;
        const userId = req.user.id;

        if (!role || !['CLIENT', 'FREELANCER'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role selected' });
        }

        // 1. Update Profile (Triggers DB-level sync to public.users via Trigger)
        const { data: profile, error } = await adminClient
            .from('profiles')
            .update({ role })
            .eq('user_id', userId)
            .select('id:user_id, user_id, email, name, avatar_url, role, title, bio, location, skills, hourly_rate, step_data, is_email_verified, profile_completed, profile_completion_percentage, onboarding_step, is_client_profile_complete')
            .single();

        if (error) throw error;

        // 2. Sync with Supabase Auth metadata
        await adminClient.auth.admin.updateUserById(userId, {
            user_metadata: { role }
        });

        res.status(200).json({
            success: true,
            message: 'Role updated successfully',
            data: { role: profile.role, profile }
        });
    } catch (error) {
        logger.error('[UpdateRole] Error:', error);
        next(error);
    }
};

/**
 * ── Authoritative Session Verification (Gap #1 Anti-Spoofing) ────────
 * Returns current user's role and profile — used for refresh hydration check.
 */
exports.verifySession = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // 1. Fetch Profile (Core Requirement)
        const { data: profile, error: profileError } = await adminClient
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (profileError || !profile) {
            logger.error('[VerifySession] Profile missing or error:', profileError);
            return res.status(404).json({ success: false, message: 'User profile not found' });
        }

        // 2. Defensive Background Sync (Prevents secondary failures from 500ing)
        let membership = null;
        let isAdmin = false;
        let role = profile.role;

        try {
            // Admin Check
            const { data: adminRecord } = await adminClient.from('admins').select('role').eq('id', userId).maybeSingle();
            if (adminRecord) {
                role = adminRecord.role;
                isAdmin = true;
            }

            // Membership Check (Robust schema-agnostic approach)
            const { data: mData } = await adminClient
                .from('memberships')
                .select('plan_id, status, end_date, plan_snapshot, plan:membership_plans(name)')
                .eq('user_id', userId)
                .eq('status', 'ACTIVE')
                .maybeSingle();
            membership = mData;

            // Economy Sync (Non-blocking)
            if (connectsService && connectsService.handleMonthlyReset) {
                const planName = membership?.plan?.name || membership?.plan_snapshot?.name || 'FREE';
                connectsService.handleMonthlyReset(userId, planName).catch(e => logger.warn('[VerifySession] Economy sync failed quietly:', e.message));
            }
        } catch (backgroundErr) {
            logger.warn('[VerifySession] Non-blocking background sync error:', backgroundErr.message);
        }

        // 3. Return authoritative payload
        res.status(200).json({
            success: true,
            data: {
                user: { 
                    id: userId, 
                    email: req.user.email, 
                    full_name: profile.name, 
                    role,
                    is_profile_complete: profile.profile_completed || profile.profile_completion_percentage >= 100,
                    is_client_profile_complete: profile.is_client_profile_complete
                },
                role,
                profile: { ...profile, membership },
                isAdmin,
                membership
            }
        });
    } catch (error) {
        logger.error('[VerifySession] FATAL 500:', error);
        res.status(500).json({ success: false, message: 'Authoritative verification failed' });
    }
};

exports.resendVerification = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const { data: profile } = await adminClient.from('profiles').select('user_id, name').eq('email', email).maybeSingle();
        if (!profile) return res.status(404).json({ success: false, message: 'User not found' });

        const verificationToken = generateVerificationToken();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const { error: updateError } = await adminClient
            .from('profiles')
            .update({ 
                email_token: verificationToken, 
                otp_expires_at: expires 
            })
            .eq('user_id', profile.user_id);

        if (updateError) {
            logger.error('[Resend Verification] Error updating profile:', updateError);
            return res.status(500).json({ success: false, message: 'Failed to generate token' });
        }

        const backendUrl = process.env.NODE_ENV === 'development' 
            ? `http://localhost:${process.env.PORT || 5001}` 
            : (process.env.BACKEND_URL || 'https://connect-backend-1-dm8d.onrender.com');

        const verifyLink = `${backendUrl}/api/auth/verify-email?token=${verificationToken}&uid=${profile.user_id}`;

        let name = profile.name || email.split('@')[0];

        await sendVerificationLinkEmail(email, verifyLink, name, true);
        
        res.status(200).json({ success: true, message: 'Verification email resent successfully' });
    } catch (err) {
        next(err);
    }
};
