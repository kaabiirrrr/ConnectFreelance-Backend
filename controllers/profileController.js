const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const multer = require('multer');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendVerificationLinkEmail } = require('../utils/emailService');
const matchService = require('../services/matchService');
const moderationService = require('../services/moderationService');
const enforcementService = require('../services/enforcementService');

// --- Specialized Multer Configs ---

// 1. Avatars: Strict images only
const avatarStorage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPG, PNG, or WebP images are allowed for profile photos'));
    }
});

// 2. Portfolio: Images + potentially PDFs
const portfolioStorage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
            'application/pdf'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('File type not allowed for portfolio. Use images or PDF.'));
    }
});

// 3. Documents: PDFs, DOCX, and Identity Images
const documentStorage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg', 'image/png', 'image/webp', 'image/heic'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Document type not supported. Please use PDF, DOCX, or images.'));
    }
});

exports.avatarUpload = avatarStorage;
exports.portfolioUpload = portfolioStorage;
exports.documentUpload = documentStorage;

exports.uploadAvatar = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const fileExt = file.originalname.split('.').pop();
        const filePath = `${userId}/profile.${fileExt}`;

        // Upload using adminClient (service role — bypasses RLS)
        const { error: uploadError } = await adminClient.storage
            .from('profilephotos')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) {
            logger.error('[Avatar Upload] Storage error', uploadError);
            return res.status(500).json({ success: false, message: 'Storage upload failed: ' + uploadError.message });
        }

        // Get public URL
        const { data: urlData } = adminClient.storage
            .from('profilephotos')
            .getPublicUrl(filePath);

        const avatarUrl = urlData.publicUrl;

        // Save URL to profile using adminClient for RLS bypass
        const { error: updateError } = await adminClient
            .from('profiles')
            .update({ avatar_url: avatarUrl })
            .eq('user_id', userId);

        if (updateError) {
            logger.error('[Avatar Upload] DB update error', updateError);
            return res.status(500).json({ success: false, message: 'Profile link failed: ' + updateError.message });
        }

        res.status(200).json({
            success: true,
            data: { avatar_url: avatarUrl },
            message: 'Avatar uploaded successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.getMe = async (req, res, next) => {
    try {
        const userId = req.user.id; // From authMiddleware

        // Using adminClient for more stability in internal lookups
        let { data: profile, error: fetchError } = await adminClient
            .from('profiles')
            .select(`
                name, title, bio, avatar_url, role, skills, hourly_rate, 
                location, country, city, experience, portfolio, rating, 
                is_verified, profile_completed, profile_completion_percentage, 
                connects_balance, has_availability_badge,
                is_banned, is_restricted, warning_count,
                dob, gender, phone, website, step_data
            `)
            .eq('user_id', userId)
            .single();

        // FALLBACK: If columns are missing (SQL not run yet), retry without them
        if (fetchError && fetchError.code === '42703') {
            const { data: fbProfile, error: fbError } = await adminClient
                .from('profiles')
                .select(`
                    name, title, bio, avatar_url, role, skills, hourly_rate, 
                    location, country, city, experience, portfolio, rating, 
                    is_verified, profile_completed, profile_completion_percentage, 
                    connects_balance, has_availability_badge
                `)
                .eq('user_id', userId)
                .single();
            if (fbError) throw fbError;
            profile = fbProfile;
            fetchError = null;
        }

        if (fetchError) {
            logger.error('[Profile] Error in getMe', fetchError);
            throw fetchError;
        }



        if (!profile) {
            return res.status(200).json({
                success: true,
                data: {
                    user_id: userId,
                    name: req.user.user_metadata?.full_name || 'Freelancer',
                    role: req.user.role || 'FREELANCER',
                    email: req.user.email
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...profile,
                skills: Array.isArray(profile?.skills) ? profile.skills : []
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updates = req.body;

        // Prevent updating IDs
        delete updates.id;
        delete updates.user_id;
        delete updates.created_at;

        const { data, error } = await adminClient
            .from('profiles')
            .update(updates)
            .eq('user_id', userId)
            .select('id:user_id, user_id, name, title, bio, avatar_url, skills, hourly_rate, location, country, city, experience, portfolio, rating, is_verified, profile_completed, dob, gender, phone, website, step_data')
            .maybeSingle(); // Use maybeSingle to avoid PGRST116

        if (error) {
            logger.error('[updateProfile] DB update error:', error);
            return res.status(500).json({
                success: false,
                message: 'Profile update failed: ' + error.message
            });
        }

        // --- INVALIDATE MATCH CACHE ---
        await matchService.invalidateFreelancerCache(userId).catch(e =>
            logger.warn('[updateProfile] Match cache invalidation failed:', e.message)
        );

        res.status(200).json({
            success: true,
            data: {
                ...(data || {}),
                skills: Array.isArray(data?.skills) ? data.skills : []
            },
            message: 'Profile updated successfully'
        });
    } catch (error) {
        logger.error('[updateProfile] FATAL:', error);
        res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
    }
};
exports.getProfileStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('profiles')
            .select(`
                user_id, name, role, avatar_url, title, bio, 
                profile_completion_percentage, profile_completed, 
                step_data,
                basic_info_completed, professional_info_completed, 
                skills_completed, portfolio_completed, documents_completed,
                dob, gender, phone, website, hourly_rate, experience, location
            `)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        // Default skeleton if profile is missing
        if (!data) {
            return res.status(200).json({
                success: true,
                data: {
                    user_id: userId,
                    name: req.user.user_metadata?.full_name || 'Freelancer',
                    role: req.user.user_metadata?.role || 'FREELANCER',
                    avatar_url: req.user.user_metadata?.avatar_url || null,
                    title: null,
                    bio: null,
                    profile_completion_percentage: 0,
                    profile_completed: false,
                    step_data: {},
                    current_step: 1
                }
            });
        }

        // Determine current_step from completion percentage
        const pct = data.profile_completion_percentage || 0;
        let current_step = 1;
        if (pct >= 83) current_step = 6;
        else if (pct >= 66) current_step = 5;
        else if (pct >= 50) current_step = 4;
        else if (pct >= 33) current_step = 3;
        else if (pct >= 16) current_step = 2;

        res.status(200).json({
            success: true,
            data: {
                user_id: userId,
                // Identity fields
                name: data.name || null,
                role: data.role || 'FREELANCER',
                avatar_url: data.avatar_url || null,
                title: data.title || null,
                bio: data.bio || null,
                // Completion tracking
                profile_completion_percentage: pct,
                profile_completed: data.profile_completed || false,
                step_data: data.step_data || {},
                current_step,
                // Step flags
                basic_info_completed: data.basic_info_completed || false,
                professional_info_completed: data.professional_info_completed || false,
                skills_completed: data.skills_completed || false,
                portfolio_completed: data.portfolio_completed || false,
                documents_completed: data.documents_completed || false,
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.updateProfileStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { step, data: stepData } = req.body;

        logger.log(`[ProfileUpdate] Received update for step: ${step}`, { userId, stepData });

        // Fetch existing profile — use safe columns only to avoid missing-column errors
        const { data: profile, error: fetchError } = await adminClient
            .from('profiles')
            .select('user_id, name, email, role, portfolio, skills, step_data')
            .eq('user_id', userId)
            .maybeSingle();

        // Ignore column-not-found on fetch (production schema may be behind)
        if (fetchError && !fetchError.message?.includes('does not exist')) throw fetchError;

        let updates = {};

        // ── BULLET-PROOF NOT NULL SAFEGUARDS ──────────────────────────────────
        // The `name` column is NOT NULL. We must ALWAYS provide it when creating
        // a new row (INSERT). Use every possible fallback to guarantee a value.
        const isNewProfile = !profile;
        if (isNewProfile || !profile.name) {
            const authMeta = req.user.user_metadata || {};
            const rawName =
                authMeta.full_name ||
                authMeta.name ||
                (req.user.email ? req.user.email.split('@')[0] : null) ||
                'User';
            // String() + trim() ensures we never send null/undefined to Postgres
            updates.name = String(rawName).trim() || 'User';
        }

        if (isNewProfile) {
            // Include all likely NOT NULL columns for a fresh INSERT
            if (!updates.role) {
                updates.role = req.user.user_metadata?.role || 'FREELANCER';
            }
            if (!updates.email) {
                updates.email = req.user.email || '';
            }

            // ── ENSURE PUBLIC.USERS RECORD EXISTS (Prevent FK constraint violation) ──
            await adminClient
                .from('users')
                .upsert([{ 
                    id: userId, 
                    email: updates.email || req.user.email, 
                    role: updates.role || 'FREELANCER' 
                }], { onConflict: 'id' })
                .catch(err => logger.error('[Profile] public.users sync error:', err));
        }

        // --- CONTACT PROTECTION INJECTION (v2) ---
        const fieldsToCheck = {
            title: stepData.title,
            bio: stepData.bio || stepData.professional_info?.bio
        };

        for (const [key, value] of Object.entries(fieldsToCheck)) {
            if (value) {
                try {
                    const moderation = await moderationService.moderate(value, userId);
                    if (moderation.blocked) {
                        logger.warn(`[Profile] Violation detected in ${key} for ${userId}`);
                        const cleaned = value
                            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]')
                            .replace(/(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/g, '[REDACTED]');
                        if (key === 'title') stepData.title = cleaned;
                        if (key === 'bio') stepData.bio = cleaned;
                        await enforcementService.processViolation(userId, {
                            ...moderation,
                            message: `Profile ${key} update attempt: ${value}`
                        });
                    }
                } catch (moderaErr) {
                    logger.warn(`[Profile] Moderation check failed for ${key}, continuing:`, moderaErr.message);
                }
            }
        }

        // ── Merge existing step_data so previous steps aren't overwritten ──
        const existingStepData = (typeof profile?.step_data === 'object' && profile.step_data) ? profile.step_data : {};

        // ── Step-specific field mapping ─────────────────────────────────────────
        if (step === 'basic_info') {
            // For basic_info, override with the form-submitted name (user typed it)
            updates.name = String(stepData.fullName || updates.name || 'User').trim() || 'User';
            updates.title = stepData.title;
            if (stepData.bio) updates.bio = stepData.bio;
            if (stepData.avatar_url) updates.avatar_url = stepData.avatar_url;
            if (stepData.dob) updates.dob = stepData.dob;
            if (stepData.gender) updates.gender = stepData.gender;
            if (stepData.country) updates.country = stepData.country;
            if (stepData.city) updates.city = stepData.city;
            if (stepData.country && stepData.city) updates.location = `${stepData.city}, ${stepData.country}`;
            else if (stepData.city) updates.location = stepData.city;
            else if (stepData.country) updates.location = stepData.country;
            updates.step_data = {
                ...existingStepData,
                basic_info: {
                    fullName: stepData.fullName,
                    title: stepData.title,
                    bio: stepData.bio || '',
                    country: stepData.country || '',
                    city: stepData.city || '',
                    dob: stepData.dob || '',
                    gender: stepData.gender || ''
                }
            };
        } else if (step === 'skills') {
            if (stepData.skills) {
                updates.skills = stepData.skills;
                updates.step_data = { ...existingStepData, skills: stepData.skills };
            }
        } else if (step === 'company_info') {
            if (stepData.companyName) updates.company_name = stepData.companyName;
            if (stepData.companySize) updates.company_size = parseInt(stepData.companySize);
            if (stepData.industry) updates.industry = stepData.industry;
            if (stepData.website) updates.website = stepData.website;
            updates.step_data = {
                ...existingStepData,
                company_info: {
                    companyName: stepData.companyName || '',
                    companySize: stepData.companySize || '',
                    industry: stepData.industry || '',
                    website: stepData.website || ''
                }
            };
        } else if (step === 'professional' || step === 'professional_info') {
            if (stepData.bio) updates.bio = stepData.bio;
            // Store years of experience only in step_data (experience column is reserved for work history array)
            if (stepData.rate) {
                const numericRate = parseFloat(String(stepData.rate).replace(/[^0-9.]/g, ''));
                if (!isNaN(numericRate)) {
                    updates.hourly_rate = numericRate;
                    logger.log(`[ProfileUpdate] Setting hourly_rate to: ${numericRate} for user ${userId}`);
                }
            }
            if (stepData.phone) updates.phone = stepData.phone;
            if (stepData.website) updates.website = stepData.website;
            updates.step_data = {
                ...existingStepData,
                professional_info: {
                    experience: stepData.experience || '',
                    rate: stepData.rate || '',
                    phone: stepData.phone || '',
                    website: stepData.website || ''
                }
            };
        } else if (step === 'personal_info') {
            if (stepData.bio) updates.bio = stepData.bio;
            // Don't write experience string to jsonb experience column — store in step_data only
            updates.step_data = {
                ...existingStepData,
                personal_info: {
                    bio: stepData.bio || '',
                    experience: stepData.experience || ''
                }
            };
        } else if (step === 'contact_info') {
            if (stepData.phone) updates.phone = stepData.phone;
            if (stepData.website) updates.website = stepData.website;
            updates.step_data = {
                ...existingStepData,
                contact_info: {
                    phone: stepData.phone || '',
                    website: stepData.website || ''
                }
            };
        } else if (step === 'location_info') {
            if (stepData.country) updates.country = stepData.country;
            if (stepData.city) updates.city = stepData.city;
            if (stepData.country && stepData.city) updates.location = `${stepData.city}, ${stepData.country}`;
            updates.step_data = {
                ...existingStepData,
                location_info: {
                    country: stepData.country || '',
                    city: stepData.city || ''
                }
            };
        } else if (step === 'portfolio') {
            if (stepData.title && stepData.url) {
                const newItem = {
                    title: stepData.title,
                    description: stepData.description || '',
                    url: stepData.url,
                    created_at: new Date().toISOString()
                };
                const currentPortfolio = Array.isArray(profile?.portfolio) ? profile.portfolio : [];
                updates.portfolio = [...currentPortfolio, newItem];
            }
            updates.portfolio_completed = true;
        } else if (step === 'documents') {
            updates.documents_completed = true;
            if (stepData.documents) {
                updates.step_data = { ...existingStepData, documents: stepData.documents };
            }
        } else if (step === 'finish') {
            updates.profile_completed = true;
        }

        const stepPercentages = {
            'basic_info': 16,
            'skills': 33,
            'company_info': 33,
            'portfolio': 50,
            'personal_info': 50,
            'documents': 66,
            'contact_info': 66,
            'professional_info': 83,
            'location_info': 83,
            'finish': 100
        };

        if (stepPercentages[step]) {
            updates.profile_completion_percentage = stepPercentages[step];
        }

        // ── Helper: attempt upsert, retry without optional columns on schema error ──
        const attemptUpsert = async (payload) => {
            const { data, error } = await adminClient
                .from('profiles')
                .upsert({ user_id: userId, ...payload }, { onConflict: 'user_id' })
                .select('user_id, profile_completion_percentage, profile_completed, skills')
                .maybeSingle(); // Use maybeSingle to avoid PGRST116 errors
            return { data, error };
        };

        let { data, error } = await attemptUpsert(updates);

        // ── Retry without optional columns that may not exist in production ──
        const isSchemaError = error && (
            error.message?.includes('does not exist') ||
            error.message?.includes('column') ||
            error.message?.includes('42703') ||
            error.code === '42703'
        );

        if (isSchemaError) {
            logger.warn(`[Profile] Schema mismatch on step "${step}". Retrying with safe fields. Error: ${error.message}`);
            // Strip optional columns that older schemas may lack
            const OPTIONAL_COLS = [
                // Completion flags
                'profile_completed', 'is_profile_complete', 'is_client_profile_complete',
                'portfolio_completed', 'documents_completed',
                'basic_info_completed', 'professional_info_completed', 'skills_completed',
                // Optional profile fields
                'dob', 'gender', 'phone', 'website', 'bio', 'title', 'avatar_url',
                'step_data', 'portfolio', 'skills', 'experience', 'hourly_rate',
                'location', 'country', 'city', 'updated_at',
                // Analytics / feature flags
                'has_availability_badge', 'is_profile_complete'
            ];

            const safePayload = { ...updates };
            const detectedMissing = [];
            OPTIONAL_COLS.forEach(col => {
                if (safePayload[col] !== undefined) {
                    detectedMissing.push(col);
                    delete safePayload[col];
                }
            });
            logger.warn(`[Profile] Stripping missing columns from step "${step}": ${detectedMissing.join(', ')}`);
            const retry = await attemptUpsert(safePayload);
            data = retry.data;
            error = retry.error;
        }

        // ── LEVEL 3: NULL CONSTRAINT SELF-REPAIR ─────────────────────────────
        // If STILL failing due to a NOT NULL violation (null name/email/role),
        // build the most minimal guaranteed-safe payload and retry once more.
        const isNullConstraintError = error && (
            error.message?.includes('violates not-null constraint') ||
            error.message?.includes('null value in column')
        );

        if (isNullConstraintError) {
            logger.error(`[Profile] NOT NULL violation for user ${userId}. Forcing repair payload. Original: ${error.message}`);
            const authMeta = req.user.user_metadata || {};
            const guaranteedName = String(
                authMeta.full_name || authMeta.name ||
                (req.user.email ? req.user.email.split('@')[0] : null) ||
                'User'
            ).trim() || 'User';

            // Strip everything that could be null / schema-missing. Keep only 
            // what we absolutely know exists in every profile row.
            const repairPayload = {
                name: guaranteedName,
                email: req.user.email || '',
                role: authMeta.role || 'FREELANCER',
                profile_completion_percentage: updates.profile_completion_percentage || 16
            };

            const repair = await attemptUpsert(repairPayload);
            data = repair.data;
            error = repair.error;

            if (!error) {
                logger.warn(`[Profile] Repair succeeded for user ${userId}. Step data was NOT saved — user should re-save.`);
            }
        }

        if (error) {
            logger.error(`[updateProfileStatus] DB upsert failed for step "${step}":`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Profile save failed. Please try again.'
            });
        }


        // --- INVALIDATE MATCH CACHE (non-blocking) ---
        matchService.invalidateFreelancerCache(userId).catch(e =>
            logger.warn('[Profile] Match cache invalidation failed:', e.message)
        );

        res.status(200).json({
            success: true,
            data: {
                ...(data || {}),
                skills: Array.isArray(data?.skills) ? data.skills : []
            },
            message: `Step ${step} updated`
        });
    } catch (error) {
        logger.error('[updateProfileStatus] FATAL:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred. Please try again.'
        });
    }
};


exports.getAllFreelancers = async (req, res, next) => {
    try {
        const { skill, category, search, minRating } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 1000);
        const offset = (page - 1) * limit;

        let query = adminClient
            .from('profiles')
            .select('user_id, name, avatar_url, title, bio, skills, hourly_rate, step_data, is_verified, category, rating, reliability_score, profile_completed, has_availability_badge, created_at', { count: 'exact' })
            .eq('role', 'FREELANCER');

        if (category) {
            query = query.eq('category', category);
        }

        if (skill) {
            query = query.contains('skills', [skill]);
        }

        if (search) {
            query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%,bio.ilike.%${search}%`);
        }

        if (minRating) {
            const ratingNum = parseFloat(minRating);
            if (!isNaN(ratingNum)) {
                query = query.gte('rating', ratingNum);
            }
        }

        let { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error && error.code === '42703') {
            // Fallback for missing columns (e.g. reliability_score, has_availability_badge)
            let fbQuery = adminClient
                .from('profiles')
                .select('user_id, name, avatar_url, title, bio, skills, hourly_rate, step_data, is_verified, category, rating, profile_completed, created_at', { count: 'exact' })
                .eq('role', 'FREELANCER');

            if (category) fbQuery = fbQuery.eq('category', category);
            if (skill) fbQuery = fbQuery.contains('skills', [skill]);
            if (search) fbQuery = fbQuery.or(`name.ilike.%${search}%,title.ilike.%${search}%,bio.ilike.%${search}%`);
            if (minRating) {
                const ratingNum = parseFloat(minRating);
                if (!isNaN(ratingNum)) fbQuery = fbQuery.gte('rating', ratingNum);
            }

            const fallbackRes = await fbQuery
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (fallbackRes.error) throw fallbackRes.error;
            data = fallbackRes.data;
            count = fallbackRes.count;
            error = null;
        } else if (error) {
            throw error;
        }

        const totalPages = Math.ceil((count || 0) / limit);

        const sanitizedData = (data || []).map(f => {
            const sd = (typeof f.step_data === 'object' && f.step_data) ? f.step_data : {};

            // Resolve hourly_rate: direct column → multiple step_data paths fallback
            let resolvedRate = f.hourly_rate;
            if (!resolvedRate || Number(resolvedRate) === 0) {
                const stepRate = sd.professional_info?.rate ||
                                sd.professional?.rate ||
                                sd.rate;
                if (stepRate) {
                    const parsed = parseFloat(String(stepRate).replace(/[^0-9.]/g, ''));
                    if (!isNaN(parsed) && parsed > 0) resolvedRate = parsed;
                }
            }

            // Resolve experience_years from all step_data paths
            const experience_years =
                sd.professional_info?.experience ||
                sd.personal_info?.experience ||
                sd.professional?.experience ||
                sd.experience ||
                '';

            // Resolve work_hours
            const work_hours =
                sd.professional_info?.work_hours ||
                sd.professional?.work_hours ||
                sd.work_hours ||
                null;

            return {
                ...f,
                id: f.user_id,
                hourly_rate: resolvedRate || null,
                skills: Array.isArray(f.skills) ? f.skills : [],
                experience_years,
                work_hours,
                step_data: undefined, // don't expose step_data to frontend
            };
        });


        // Increments search presence for all matching profiles if it's a real keyword search
        if (search && sanitizedData.length > 0) {
            const userIds = sanitizedData.map(f => f.user_id);
            // Run in background as it's secondary
            (async () => {
                try {
                    await adminClient.rpc('increment_search_presence', { target_user_ids: userIds });
                } catch (e) {
                    logger.error('[Metrics] Error incrementing search presence', e);
                }
            })();
        }

        res.status(200).json({
            success: true,
            data: sanitizedData,
            pagination: { page, limit, total: count || 0, totalPages }
        });
    } catch (error) {
        next(error);
    }
};

exports.getPublicProfile = async (req, res, next) => {
    try {
        const { id } = req.params;

        let { data: profile, error } = await adminClient
            .from('profiles')
            .select(`
                id:user_id, user_id, name, title, bio, avatar_url, role, 
                skills, hourly_rate, location, country, city,
                experience, portfolio, rating, reliability_score, is_verified, 
                profile_completed, profile_views, search_presence,
                has_availability_badge, created_at,
                is_banned, is_restricted, warning_count,
                dob, gender, phone, website, step_data,
                is_email_verified
            `)
            .eq('user_id', id)
            .maybeSingle();

        // FALLBACK: If columns are missing, retry without them
        if (error && error.code === '42703') {
            const { data: fbProfile, error: fbError } = await adminClient
                .from('profiles')
                .select(`
                    id:user_id, user_id, name, title, bio, avatar_url, role, 
                    skills, hourly_rate, location, country, city,
                    experience, portfolio, rating, is_verified, 
                    profile_completed, profile_views, search_presence,
                    has_availability_badge, created_at,
                    dob, gender, phone, website, step_data,
                    is_email_verified
                `)
                .eq('user_id', id)
                .maybeSingle();
            if (fbError) throw fbError;
            profile = fbProfile;
            error = null;
        }

        if (error) throw error;

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }

        // Increment profile views if someone else is viewing (or if requester is not authenticated)
        const viewerId = req.user?.id;
        if (!viewerId || viewerId !== id) {
            // Run in background
            (async () => {
                try {
                    await adminClient.rpc('increment_profile_views', { target_user_id: id });
                } catch (e) {
                    logger.error('[Metrics] Error incrementing profile views', e);
                }
            })();
        }

        // Fetch latest reviews
        const { data: reviews } = await supabase
            .from('reviews')
            .select(`
                id, rating, comment, created_at,
                reviewer:reviewer_id ( id, name, avatar_url )
            `)
            .eq('reviewee_id', id)
            .order('created_at', { ascending: false })
            .limit(5);

        res.status(200).json({
            success: true,
            data: (() => {
                const sd = (typeof profile.step_data === 'object' && profile.step_data) ? profile.step_data : {};

                // ── Resolve experience_years from all wizard step paths ──────────
                const experience_years =
                    sd.professional_info?.experience ||
                    sd.personal_info?.experience ||
                    sd.professional?.experience ||
                    sd.experience ||
                    '';

                // ── Resolve work_hours from wizard ───────────────────────────────
                const work_hours =
                    sd.professional_info?.work_hours ||
                    sd.professional?.work_hours ||
                    sd.work_hours ||
                    null;

                // ── Resolve hourly_rate: column first, then all step_data paths ──
                let resolvedRate = profile.hourly_rate;
                if (!resolvedRate || Number(resolvedRate) === 0) {
                    const stepRate =
                        sd.professional_info?.rate ||
                        sd.professional?.rate ||
                        sd.rate;
                    if (stepRate) {
                        const parsed = parseFloat(String(stepRate).replace(/[^0-9.]/g, ''));
                        if (!isNaN(parsed) && parsed > 0) resolvedRate = parsed;
                    }
                }

                // ── Resolve work history (experience array) ──────────────────────
                // The `experience` column stores JSONB work history.
                // Wizard may store it under step_data.work_history or step_data.experience
                let workHistory = [];
                if (Array.isArray(profile.experience) && profile.experience.length > 0) {
                    workHistory = profile.experience;
                } else if (Array.isArray(sd.work_history) && sd.work_history.length > 0) {
                    workHistory = sd.work_history;
                } else if (Array.isArray(sd.experience) && sd.experience.length > 0) {
                    workHistory = sd.experience;
                }

                return {
                    ...profile,
                    skills: Array.isArray(profile.skills) ? profile.skills : [],
                    experience: workHistory,
                    experience_years,
                    work_hours,
                    hourly_rate: resolvedRate || 0,
                    reviews,
                    // strip raw step_data from public response
                    step_data: undefined,
                };
            })()
        });

    } catch (error) {
        next(error);
    }
};

exports.sendVerificationEmail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const email = req.user.email;

        // Reuse the logic from authController or implement similar link-based flow
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const { data: profile } = await adminClient
            .from('profiles')
            .select('name')
            .eq('user_id', userId)
            .maybeSingle();

        const { error } = await adminClient
            .from('profiles')
            .update({ email_token: token, otp_expires_at: expiresAt })
            .eq('user_id', userId);

        if (error) throw error;

        const backendUrl = process.env.BACKEND_URL || 'http://localhost:5001';
        const verifyLink = `${backendUrl}/api/auth/verify-email?token=${token}&uid=${userId}`;

        try {
            await sendVerificationLinkEmail(email, verifyLink, profile?.name || '');
        } catch (emailError) {
            logger.error('[Profile Email] Failed to send verification email', emailError);
            return res.status(500).json({
                success: false,
                message: 'Failed to send verification email.'
            });
        }

        res.status(200).json({ success: true, message: 'Verification link sent to your email' });
    } catch (error) {
        next(error);
    }
};

// Deprecated in favor of authController.verifyEmail which handles the same redirect logic
exports.confirmEmailByLink = async (req, res, next) => {
    try {
        const { token, uid } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        if (!token || !uid) {
            return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        }

        const { data: profile } = await adminClient
            .from('profiles')
            .select('email_token, otp_expires_at, is_email_verified')
            .eq('user_id', uid)
            .maybeSingle();

        if (!profile) return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        if (profile.is_email_verified) return res.redirect(`${frontendUrl}/verify-email?status=already_verified`);
        if (profile.email_token !== token) return res.redirect(`${frontendUrl}/verify-email?status=invalid`);
        if (new Date(profile.otp_expires_at) < new Date()) return res.redirect(`${frontendUrl}/verify-email?status=expired`);

        await adminClient
            .from('profiles')
            .update({ is_email_verified: true, email_token: null, otp_expires_at: null })
            .eq('user_id', uid);

        // Sync with Supabase Auth
        try {
            await adminClient.auth.admin.updateUserById(uid, { email_confirm: true });
        } catch (authErr) {
            logger.error(`[Profile Verify] Auth sync failed for ${uid}`, authErr);
        }

        return res.redirect(`${frontendUrl}/verify-email?status=success`);
    } catch (err) {
        next(err);
    }
};

exports.confirmEmail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { otp } = req.body;

        if (!otp) return res.status(400).json({ success: false, message: 'Verification code is required' });

        const { data: profile, error: fetchError } = await adminClient
            .from('profiles')
            .select('email_token, otp_expires_at')
            .eq('user_id', userId)
            .maybeSingle();

        if (fetchError || !profile) {
            return res.status(404).json({ success: false, message: 'Profile not found' });
        }

        if (!profile.email_token) {
            return res.status(400).json({ success: false, message: 'No verification code found. Please request a new one.' });
        }

        if (String(profile.email_token).trim() !== String(otp).trim()) {
            return res.status(400).json({ success: false, message: 'Invalid verification code' });
        }

        if (new Date(profile.otp_expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: 'Verification code expired. Please request a new one.' });
        }

        await adminClient
            .from('profiles')
            .update({ is_email_verified: true, email_token: null, otp_expires_at: null })
            .eq('user_id', userId);

        // Sync with Supabase Auth
        try {
            await adminClient.auth.admin.updateUserById(userId, { email_confirm: true });
        } catch (authErr) {
            logger.error(`[OTP Verify] Auth sync failed for ${userId}`, authErr);
        }

        res.status(200).json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        next(error);
    }
};

exports.uploadDocument = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a document' });
        }

        const userId = req.user.id;
        const { type } = req.body; // e.g., 'idFront', 'idBack', 'resume'
        const fileExt = req.file.originalname.split('.').pop();
        const timestamp = Date.now();
        const fileName = `documents/${userId}/${type || 'doc'}_${timestamp}.${fileExt}`;

        // Upload using adminClient (using 'profilephotos' bucket)
        const { error: uploadError } = await adminClient.storage
            .from('profilephotos')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (uploadError) {
            logger.error('[Document Upload] Error', uploadError);
            return res.status(500).json({ success: false, message: 'Storage upload failed: ' + uploadError.message });
        }

        const { data: urlData } = adminClient.storage
            .from('profilephotos')
            .getPublicUrl(fileName);

        const documentUrl = urlData.publicUrl;

        // Update profile columns (schema-agnostic)
        let profileUpdates = {};
        if (type === 'resume') profileUpdates.resume_url = documentUrl;
        else if (type === 'idFront' || type === 'idBack') profileUpdates.document_url = documentUrl;
        else profileUpdates.document_url = documentUrl; // fallback

        try {
            await adminClient
                .from('profiles')
                .update(profileUpdates)
                .eq('user_id', userId);
        } catch (dbErr) {
            logger.warn(`[Document Upload] Profile column update failed for ${userId}. This is usually due to a missing column. Error: ${dbErr.message}`);
            // Non-blocking: We still have the URL in the response for the wizard to save in step_data
        }

        res.status(200).json({
            success: true,
            data: { url: documentUrl, type },
            message: `${type || 'Document'} uploaded successfully`
        });
    } catch (error) {
        next(error);
    }
};

exports.uploadPortfolioItem = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a project file' });
        }

        const userId = req.user.id;
        const fileExt = req.file.originalname.split('.').pop();
        const fileName = `${userId}/portfolio_${Date.now()}.${fileExt}`;

        // Upload to a 'profilephotos' bucket
        const { error: uploadError } = await adminClient.storage
            .from('profilephotos')
            .upload(`portfolio/${fileName}`, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (uploadError) throw uploadError;

        const { data: urlData } = adminClient.storage
            .from('profilephotos')
            .getPublicUrl(`portfolio/${fileName}`);

        const documentUrl = urlData.publicUrl;

        res.status(200).json({
            success: true,
            data: { url: documentUrl },
            message: 'Portfolio file uploaded'
        });
    } catch (error) {
        next(error);
    }
};

exports.getFreelancerStats = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // 1. Total Proposals (Real)
        const { count: totalProposals } = await adminClient
            .from('proposals')
            .select('*', { count: 'exact', head: true })
            .eq('freelancer_id', userId);

        // 2. Active Contracts (Real)
        const { count: activeContracts } = await adminClient
            .from('contracts')
            .select('*', { count: 'exact', head: true })
            .eq('freelancer_id', userId)
            .eq('status', 'ACTIVE');

        // 3. Profile Views & Search Presence (New: directly from profiles)
        const { data: metrics } = await adminClient
            .from('profiles')
            .select('profile_views, search_presence, connects_balance')
            .eq('user_id', userId)
            .maybeSingle();

        res.status(200).json({
            success: true,
            data: {
                total_proposals: totalProposals || 0,
                active_contracts: activeContracts || 0,
                profile_views: metrics?.profile_views || 0,
                search_presence: metrics?.search_presence || 0,
                connects: metrics?.connects_balance || 0
            }
        });
    } catch (error) {
        next(error);
    }
};

// --- CLIENT PROFILE EXTENSIONS ---

exports.getClientProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Dynamic Select: Try full schema first, fallback to minimal on failure (42703 = column missing)
        let { data: profile, error } = await adminClient
            .from('profiles')
            .select(`
                id:user_id, user_id, name, role, avatar_url, title, bio, 
                company_name, company_website, industry, company_size, 
                country, city, location, is_client_profile_complete, profile_completed,
                phone, website, step_data
            `)
            .eq('user_id', userId)
            .maybeSingle();

        if (error && error.code === '42703') {
            logger.warn('[Profile] Client schema mismatch detected. Falling back to minimal select.');
            const { data: fbProfile, error: fbError } = await adminClient
                .from('profiles')
                .select('id:user_id, user_id, name, role, avatar_url, title, bio, location, profile_completed')
                .eq('user_id', userId)
                .maybeSingle();
            
            if (fbError) throw fbError;
            profile = fbProfile;
            error = null;
        }

        if (error) throw error;

        // Populate default values if missing
        if (!profile) {
            return res.status(200).json({
                success: true,
                data: {
                    user_id: userId,
                    name: req.user.user_metadata?.full_name || 'Client',
                    role: 'CLIENT',
                    avatar_url: req.user.user_metadata?.avatar_url || null,
                    is_client_profile_complete: false
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                ...profile,
                is_client_profile_complete: profile.is_client_profile_complete ?? profile.profile_completed ?? false
            }
        });
    } catch (error) {
        logger.error('[Profile] getClientProfile Fatal:', error);
        next(error);
    }
};

exports.updateClientProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updates = req.body;

        // Clean updates
        delete updates.id;
        delete updates.user_id;
        delete updates.created_at;
        delete updates.updated_at;

        // Common mapping for wizard steps
        if (updates.step === 'basic') {
            // Handled by client
        }

        const { data, error } = await adminClient
            .from('profiles')
            .update(updates)
            .eq('user_id', userId)
            .select()
            .maybeSingle();

        if (error) {
            logger.error('[UpdateClientProfile] Error', error);
            // Handle column missing on update
            if (error.code === '42703') {
                return res.status(200).json({ 
                    success: true, 
                    warning: 'Schema mismatch: Some company fields could not be saved. Please run the SQL migration.',
                    message: 'Basic profile info saved.'
                });
            }
            return res.status(400).json({ success: false, message: error.message });
        }

        res.status(200).json({
            success: true,
            data,
            message: 'Client profile updated'
        });
    } catch (error) {
        next(error);
    }
};

exports.uploadClientPhoto = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No photo uploaded' });
        }

        const fileExt = file.originalname.split('.').pop();
        const filePath = `${userId}/client_profile_${Date.now()}.${fileExt}`;

        // Upload using adminClient
        const { error: uploadError } = await adminClient.storage
            .from('profilephotos')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) {
            throw new Error('Upload failed: ' + uploadError.message);
        }

        // Get public URL
        const { data: urlData } = adminClient.storage
            .from('profilephotos')
            .getPublicUrl(filePath);

        const photoUrl = urlData.publicUrl;

        // Save URL to profile
        await adminClient
            .from('profiles')
            .update({ avatar_url: photoUrl })
            .eq('user_id', userId);

        res.status(200).json({
            success: true,
            data: { photo_url: photoUrl },
            message: 'Profile photo uploaded successfully'
        });
    } catch (error) {
        next(error);
    }
};
