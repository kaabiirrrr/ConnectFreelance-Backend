const adminClient = require('../../supabase/adminClient');
const supabase = require('../../supabase/client');
const logger = require('../../utils/logger');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../../config/roles');
const SALT_ROUNDS = 10;

// Multer memory storage for avatar uploads (we send directly to Supabase Storage)
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    }
});
exports.avatarUpload = avatarUpload;

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, data: null, message: 'Please provide email and password' });
        }

        // 1. Fetch admin record to get the stored hash
        const { data: adminForAuth, error: fetchError } = await adminClient
            .from('admins')
            .select('id, password_hash')
            .eq('email', email)
            .maybeSingle();

        // 2. Verify with bcrypt if hash exists
        if (adminForAuth && adminForAuth.password_hash) {
            const isMatch = await bcrypt.compare(password, adminForAuth.password_hash);
            if (!isMatch) {
                return res.status(401).json({ success: false, data: null, message: 'Invalid credentials' });
            }
        } else {
            logger.warn('No bcrypt hash found for admin, falling back to Supabase Auth', { email });
        }

        // 3. Authenticate with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

        if (authError || !authData.user) {
            return res.status(401).json({ success: false, data: null, message: 'Invalid credentials' });
        }

        // 2. Verify Admin Role from admins table
        const { data: adminRecord, error: adminError } = await adminClient
            .from('admins')
            .select('*')
            .eq('id', authData.user.id)
            .maybeSingle(); // Use maybeSingle for better error handling

        if (adminError || !adminRecord) {
            // Check if it's the platform owner to auto-provision
            const PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL || 'lets.connectbro@gmail.com';
            if (authData.user.email === PLATFORM_OWNER_EMAIL) {
                // Use a transaction-like pattern for safety
                try {
                    const { data: newAdmin, error: upsertError } = await adminClient
                        .from('admins')
                        .upsert({ 
                            id: authData.user.id, 
                            email: authData.user.email, 
                            role: ROLES.SUPER_ADMIN,
                            name: authData.user.user_metadata?.full_name || authData.user.email.split('@')[0]
                        })
                        .select()
                        .maybeSingle();
                    
                    if (upsertError) {
                        logger.error('Admin auto-provision failed', upsertError);
                        // Sign out and return error - don't allow login without proper admin record
                        await supabase.auth.signOut();
                        return res.status(403).json({ 
                            success: false, 
                            message: 'Access denied: Admin profile creation failed. Please contact support.' 
                        });
                    }
                    adminRecord = newAdmin;
                } catch (provisionError) {
                    logger.error('Admin auto-provision exception', provisionError);
                    await supabase.auth.signOut();
                    return res.status(403).json({ 
                        success: false, 
                        message: 'Access denied: System error during admin provisioning.' 
                    });
                }
            } else {
                await supabase.auth.signOut();
                logger.error('Admin access denied', { email: authData.user.email });
                return res.status(403).json({ success: false, data: null, message: 'Access denied. You are not an administrator.' });
            }
        }

        // 3. Profiles table might not have last_sign_in_at, let's check
        // If it doesn't exist, this might fail unless handled.
        // For now, let's keep it simple and only update fields that definitely exist.
        // 3. Update last login in admins table
        await adminClient
            .from('admins')
            .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', authData.user.id);

        // Optional: Update profiles table if it exists
        try {
            await adminClient
                .from('profiles')
                .update({ updated_at: new Date().toISOString() })
                .eq('user_id', authData.user.id);
        } catch (e) {
            // Ignore if profile doesn't exist
        }

        res.status(200).json({
            success: true,
            data: {
                user: authData.user,
                session: authData.session,
                role: adminRecord.role,
                name: adminRecord.name || authData.user.email.split('@')[0],
                photo_url: adminRecord.photo_url
            },
            message: 'Admin logged in successfully'
        });

    } catch (error) {
        next(error);
    }
};

exports.getProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Fetch full profile record from admins table
        const { data: adminData, error: adminError } = await adminClient
            .from('admins')
            .select('*')
            .eq('id', userId)
            .maybeSingle(); // Use maybeSingle to avoid coercion errors

        if (adminError || !adminData) {
            logger.error('Admin profile load failed', adminError);
            return res.status(404).json({ 
                success: false, 
                message: 'Admin profile record not found in database. Please contact the platform owner.' 
            });
        }

        const authUser = req.user;

        res.status(200).json({
            success: true,
            data: {
                id: userId,
                email: authUser.email,
                name: adminData.name || authUser.user_metadata?.name || authUser.email.split('@')[0],
                photo_url: adminData.photo_url || null,
                role: adminData.role,
                phone: adminData.phone || authUser.phone || null,
                must_change_password: !!adminData.must_change_password,
                created_at: adminData.created_at,
                updated_at: adminData.updated_at,
                last_login_at: adminData.last_login_at || authUser.last_sign_in_at,
                email_confirmed: !!authUser.email_confirmed_at,
                last_sign_in_at: authUser.last_sign_in_at,
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.logout = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            await supabase.auth.admin.signOut(token);
        }
        res.status(200).json({ success: true, data: null, message: 'Admin logged out successfully' });
    } catch (error) {
        next(error);
    }
};

exports.updateProfile = async (req, res, next) => {
    try {
        const { email, password, name, phone } = req.body;
        const userId = req.user.id;

        // 1. Update Supabase Auth (email/password/phone)
        const authUpdateData = {};
        const dbUpdateData = { updated_at: new Date().toISOString() };

        if (email) authUpdateData.email = email;
        if (password) {
            authUpdateData.password = password;
            // When user changes password themselves, clear the 'must_change_password' flag
            dbUpdateData.must_change_password = false;
            // Generate hash for our internal database (Security requirement)
            dbUpdateData.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        }
        if (name) {
            authUpdateData.user_metadata = { ...req.user.user_metadata, name };
            dbUpdateData.name = name;
        }
        if (phone !== undefined) {
            authUpdateData.phone = phone;
            dbUpdateData.phone = phone;
        }

        if (Object.keys(authUpdateData).length > 0) {
            const { error: authError } = await supabase.auth.admin.updateUserById(userId, authUpdateData);
            if (authError) {
                logger.error('Admin auth update failed', authError);
                throw authError;
            }
        }

        // 2. Update admins DB table (Main for Admin Dashboard)

        const { data: updatedAdmin, error: adminDbError } = await adminClient
            .from('admins')
            .update(dbUpdateData)
            .eq('id', userId)
            .select()
            .maybeSingle(); 

        if (adminDbError) {
            logger.error('Admin table update failed', adminDbError);
            throw adminDbError;
        }

        if (!updatedAdmin) {
            logger.error('No admin record found to update', { userId });
            return res.status(404).json({ 
                success: false, 
                message: 'Admin profile record not found in database. Please re-login.' 
            });
        }

        // 3. Sync to profiles table ONLY if it exists (legacy support)
        try {
            const profileUpdateData = { name, updated_at: new Date().toISOString() };
            if (dbUpdateData.password_hash) {
                profileUpdateData.password_hash = dbUpdateData.password_hash;
            }
            
            await adminClient
                .from('profiles')
                .update(profileUpdateData)
                .eq('user_id', userId);
        } catch (e) {
            // Ignore if profile doesn't exist
        }

        res.status(200).json({
            success: true,
            data: updatedAdmin,
            message: 'Admin profile updated successfully'
        });

    } catch (error) {
        next(error);
    }
};

exports.uploadAvatar = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const userId = req.user.id;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        const fileName = `admin-${userId}-${Date.now()}${fileExt}`;
        const filePath = `profilephotos/${fileName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await adminClient.storage
            .from('profilephotos') 
            .upload(fileName, req.file.buffer, { 
                contentType: req.file.mimetype,
                upsert: true
            });

        if (uploadError) {
            logger.error('Avatar storage upload error', uploadError);
            throw uploadError;
        }

        // Get public URL
        const { data: { publicUrl } } = adminClient.storage
            .from('profilephotos')
            .getPublicUrl(fileName);

        // Save URL to admins table
        const { data: updatedAdmin, error: adminDbError } = await adminClient
            .from('admins')
            .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (adminDbError) {
            logger.error('Avatar DB update error', adminDbError);
            throw adminDbError;
        }

        if (!updatedAdmin) {
            logger.error('No admin record found during avatar update', { userId });
            return res.status(404).json({ success: false, message: 'Admin profile not found' });
        }

        // Sync to profiles table if it exists
        try {
            await adminClient
                .from('profiles')
                .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
                .eq('user_id', userId);
        } catch (e) {}

        res.status(200).json({
            success: true,
            data: { photo_url: publicUrl, profile: updatedAdmin },
            message: 'Avatar uploaded successfully'
        });

    } catch (error) {
        next(error);
    }
};
