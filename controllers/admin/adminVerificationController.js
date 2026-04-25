const adminClient = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const { sendVerificationReminderEmail } = require('../../utils/emailService');
const logger = require('../../utils/logger');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const REMINDER_COOLDOWN_HOURS = 48;

const canSendReminder = (lastSentAt) => {
    if (!lastSentAt) return true;
    const diff = Date.now() - new Date(lastSentAt).getTime();
    return diff > REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000;
};

// ─── GET VERIFICATION LIST (Client or Freelancer) ─────────────────────────────

exports.getVerificationList = async (req, res, next) => {
    try {
        const role = (req.params.role || 'FREELANCER').toUpperCase();
        const { status } = req.query;

        // 1. Get all users of this role from profiles
        // role column may store 'CLIENT'/'FREELANCER' or 'client'/'freelancer'
        const { data: profiles, error: profileError } = await adminClient
            .from('profiles')
            .select('user_id, name, email, avatar_url, role, created_at')
            .or(`role.eq.${role},role.eq.${role.toLowerCase()}`);

        if (profileError) throw profileError;

        // 2. Get all identity_verifications rows for these users
        const userIds = (profiles || []).map(p => p.user_id);

        let verifications = [];
        if (userIds.length > 0) {
            const { data: verData, error: verError } = await adminClient
                .from('identity_verifications')
                .select('*')
                .in('user_id', userIds);

            if (verError && verError.code !== 'PGRST116') throw verError;

            // Refresh signed URLs for each verification
            const refreshUrl = async (url) => {
                if (!url) return null;
                try {
                    const match = url.match(/\/identity-documents\/(.+?)(?:\?|$)/);
                    if (!match) return url;
                    const path = decodeURIComponent(match[1]);
                    const { data: signed } = await adminClient.storage
                        .from('identity-documents')
                        .createSignedUrl(path, 60 * 60 * 24); // 24hr
                    return signed?.signedUrl || url;
                } catch (_) { return url; }
            };

            verifications = await Promise.all((verData || []).map(async v => ({
                ...v,
                document_front_url: await refreshUrl(v.document_front_url),
                document_back_url: await refreshUrl(v.document_back_url),
                selfie_url: await refreshUrl(v.selfie_url),
            })));
        }

        // Also check verifications table as fallback
        let verifications2 = [];
        if (userIds.length > 0) {
            try {
                const { data: v2 } = await adminClient
                    .from('verifications')
                    .select('*')
                    .in('user_id', userIds);
                verifications2 = v2 || [];
            } catch (_) {
                // verifications table may not exist yet — ignore
            }
        }

        // Build lookup maps
        const verMap = {};
        verifications.forEach(v => { verMap[v.user_id] = v; });
        verifications2.forEach(v => {
            if (!verMap[v.user_id]) verMap[v.user_id] = v;
        });

        // 3. Merge: users without a verification row → NOT_SUBMITTED
        const merged = profiles.map(p => {
            const ver = verMap[p.user_id];
            const rawStatus = ver?.status?.toUpperCase() || 'NOT_SUBMITTED';
            // Normalize status values
            const statusMap = {
                'VERIFIED': 'APPROVED',
                'APPROVED': 'APPROVED',
                'PENDING': 'PENDING',
                'REJECTED': 'REJECTED',
                'NOT_SUBMITTED': 'NOT_SUBMITTED',
            };
            const normalizedStatus = statusMap[rawStatus] || 'NOT_SUBMITTED';

            return {
                user_id: p.user_id,
                name: p.name,
                email: p.email,
                avatar_url: p.avatar_url,
                role: p.role,
                profile_created_at: p.created_at,
                verification_id: ver?.id || null,
                status: normalizedStatus,
                // Individual URLs (refreshed signed URLs)
                document_front_url: ver?.document_front_url || null,
                document_back_url: ver?.document_back_url || null,
                selfie_url: ver?.selfie_url || null,
                // Combined array for display
                document_urls: [ver?.document_front_url, ver?.document_back_url, ver?.selfie_url].filter(Boolean),
                document_type: ver?.document_type || null,
                // OCR / extracted fields
                extracted_name: ver?.extracted_name || null,
                extracted_dob: ver?.extracted_dob || null,
                extracted_gender: ver?.extracted_gender || null,
                extracted_id_number: ver?.extracted_id_number || ver?.document_number || null,
                full_name: ver?.full_name || null,
                dob: ver?.dob || null,
                gender: ver?.gender || null,
                aadhaar_number: ver?.aadhaar_number || null,
                pan_number: ver?.pan_number || null,
                driving_license_number: ver?.driving_license_number || null,
                admin_notes: ver?.admin_notes || ver?.rejection_reason || null,
                last_reminder_sent_at: ver?.last_reminder_sent_at || null,
                submitted_at: ver?.submitted_at || ver?.created_at || null,
                updated_at: ver?.updated_at || ver?.reviewed_at || null,
            };
        });

        // 4. Filter by status
        const filtered = (!status || status === 'ALL')
            ? merged
            : merged.filter(u => u.status === status);

        // 5. Stats
        const stats = {
            total: merged.length,
            not_submitted: merged.filter(u => u.status === 'NOT_SUBMITTED').length,
            pending: merged.filter(u => u.status === 'PENDING').length,
            approved: merged.filter(u => u.status === 'APPROVED').length,
            rejected: merged.filter(u => u.status === 'REJECTED').length,
        };

        res.status(200).json({ success: true, data: filtered, stats });
    } catch (error) {
        logger.error('[getVerificationList] Error:', error?.message || error);
        next(error);
    }
};

// ─── APPROVE VERIFICATION ─────────────────────────────────────────────────────

exports.approveVerification = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { admin_notes } = req.body;

        // Try identity_verifications first (primary table)
        const { data: ver, error: fetchErr } = await adminClient
            .from('identity_verifications')
            .select('id, user_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!ver) return res.status(404).json({ success: false, message: 'Verification not found' });

        await adminClient
            .from('identity_verifications')
            .update({
                status: 'APPROVED',
                rejection_reason: null,
                reviewed_by: req.user.id,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', id);

        // Update profile
        await adminClient
            .from('profiles')
            .update({ is_verified: true, verification_status: 'verified' })
            .eq('user_id', ver.user_id);

        // Notify user
        await adminClient.from('notifications').insert([{
            user_id: ver.user_id,
            title: '✅ Identity Verified!',
            content: 'Your identity has been verified. You now have an IDV badge on your profile.',
            type: 'SYSTEM',
            link: '/freelancer/profile'
        }]).catch(() => {});

        await logAction(req.user.id, 'VERIFICATION_APPROVED', ver.user_id,
            `Verification approved. Notes: ${admin_notes || 'none'}`);

        res.status(200).json({ success: true, message: 'Verification approved' });
    } catch (error) {
        next(error);
    }
};

// ─── REJECT VERIFICATION ──────────────────────────────────────────────────────

exports.rejectVerification = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { admin_notes, rejection_reason } = req.body;
        const reason = admin_notes || rejection_reason || 'Does not meet requirements';

        const { data: ver, error: fetchErr } = await adminClient
            .from('identity_verifications')
            .select('id, user_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!ver) return res.status(404).json({ success: false, message: 'Verification not found' });

        await adminClient
            .from('identity_verifications')
            .update({
                status: 'REJECTED',
                rejection_reason: reason,
                reviewed_by: req.user.id,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', id);

        await adminClient
            .from('profiles')
            .update({ is_verified: false, verification_status: 'rejected' })
            .eq('user_id', ver.user_id);

        await adminClient.from('notifications').insert([{
            user_id: ver.user_id,
            title: '❌ Identity Verification Rejected',
            content: `Your identity verification was rejected. Reason: ${reason}`,
            type: 'SYSTEM',
            link: '/kyc'
        }]).catch(() => {});

        await logAction(req.user.id, 'VERIFICATION_REJECTED', ver.user_id,
            `Verification rejected. Reason: ${reason}`);

        res.status(200).json({ success: true, message: 'Verification rejected' });
    } catch (error) {
        next(error);
    }
};

// ─── SEND REMINDER EMAIL ──────────────────────────────────────────────────────

exports.sendReminder = async (req, res, next) => {
    try {
        const { user_id, role } = req.body;

        if (!user_id || !role) {
            return res.status(400).json({ success: false, message: 'user_id and role are required' });
        }

        // Get user profile
        const { data: profile, error: profileErr } = await adminClient
            .from('profiles')
            .select('name, email')
            .eq('user_id', user_id)
            .maybeSingle();

        if (profileErr) throw profileErr;
        if (!profile?.email) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Check existing verification row for cooldown
        const { data: ver } = await adminClient
            .from('identity_verifications')
            .select('id, status, last_reminder_sent_at')
            .eq('user_id', user_id)
            .maybeSingle();

        // Enforce cooldown
        if (ver?.last_reminder_sent_at && !canSendReminder(ver.last_reminder_sent_at)) {
            const nextAllowed = new Date(new Date(ver.last_reminder_sent_at).getTime() + REMINDER_COOLDOWN_HOURS * 3600000);
            return res.status(429).json({
                success: false,
                message: `Reminder already sent. Next allowed: ${nextAllowed.toLocaleString()}`
            });
        }

        // Send email
        await sendVerificationReminderEmail(profile.email, profile.name || 'User', role);

        // Update last_reminder_sent_at in identity_verifications if row exists
        if (ver?.id) {
            await adminClient
                .from('identity_verifications')
                .update({ last_reminder_sent_at: new Date().toISOString() })
                .eq('id', ver.id);
        }

        await logAction(req.user.id, 'VERIFICATION_REMINDER_SENT', user_id,
            `Reminder email sent to ${profile.email} (${role})`);

        res.status(200).json({ success: true, message: `Reminder sent to ${profile.email}` });
    } catch (error) {
        next(error);
    }
};

// ─── LEGACY: keep old endpoints working ───────────────────────────────────────

exports.getVerificationRequests = async (req, res, next) => {
    req.params.role = req.query.role || 'FREELANCER';
    return exports.getVerificationList(req, res, next);
};

exports.updateVerificationStatus = async (req, res, next) => {
    const { userId } = req.params;
    const { status, message } = req.body;
    try {
        const updateData = {
            verification_status: status,
            updated_at: new Date().toISOString()
        };
        if (status === 'APPROVED') {
            updateData.is_verified = true;
        } else {
            updateData.is_verified = false;
        }
        const { error } = await adminClient.from('profiles').update(updateData).eq('user_id', userId);
        if (error) throw error;
        await logAction(req.user.id, 'VERIFICATION_UPDATE', userId, `Verification ${status}. ${message || ''}`);
        res.status(200).json({ success: true, message: `Verification status updated to ${status}` });
    } catch (error) {
        next(error);
    }
};

exports.toggleFeaturedStatus = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { isFeatured, expiryDate } = req.body;
        const { error } = await adminClient.from('profiles')
            .update({ is_featured: isFeatured, featured_until: isFeatured ? expiryDate : null })
            .eq('user_id', userId);
        if (error) throw error;
        await logAction(req.user.id, 'FEATURED_TOGGLE', userId, `Featured set to ${isFeatured}`);
        res.status(200).json({ success: true, message: 'Freelancer featured status updated' });
    } catch (error) {
        next(error);
    }
};
