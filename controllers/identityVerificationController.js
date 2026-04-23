const adminClient = require('../supabase/adminClient');

// GET /api/identity/status — get current verification status
exports.getVerificationStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('identity_verifications')
            .select('id, status, document_type, rejection_reason, submitted_at, reviewed_at')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        // Also check profile is_verified flag
        const { data: profile } = await adminClient
            .from('profiles')
            .select('is_verified, verification_status')
            .eq('user_id', userId)
            .maybeSingle();

        res.status(200).json({
            success: true,
            data: {
                verification: data || null,
                is_verified: profile?.is_verified || false,
                verification_status: data?.status || (profile?.is_verified ? 'APPROVED' : 'NOT_SUBMITTED')
            }
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/identity/submit — submit verification documents
exports.submitVerification = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { document_type, document_front_url, document_back_url, selfie_url } = req.body;

        if (!document_type || !document_front_url) {
            return res.status(400).json({ success: false, message: 'document_type and document_front_url are required' });
        }

        const validTypes = ['passport', 'national_id', 'drivers_license'];
        // Normalize: "National ID" -> "national_id", "Driver's License" -> "drivers_license"
        const normalizedType = document_type
            .toLowerCase()
            .replace(/['\s]+/g, '_')
            .replace(/driver_s/, 'drivers');

        if (!validTypes.includes(normalizedType)) {
            return res.status(400).json({ success: false, message: `document_type must be one of: ${validTypes.join(', ')}` });
        }

        // Check if already approved
        const { data: existing } = await adminClient
            .from('identity_verifications')
            .select('status')
            .eq('user_id', userId)
            .maybeSingle();

        if (existing?.status === 'APPROVED') {
            return res.status(400).json({ success: false, message: 'Your identity is already verified.' });
        }

        // Upsert verification request
        const { data, error } = await adminClient
            .from('identity_verifications')
            .upsert([{
                user_id: userId,
                status: 'PENDING',
                document_type: normalizedType,
                document_front_url,
                document_back_url: document_back_url || null,
                selfie_url: selfie_url || null,
                submitted_at: new Date().toISOString(),
                rejection_reason: null
            }], { onConflict: 'user_id' })
            .select()
            .single();

        if (error) throw error;

        // Update profile verification_status
        await adminClient
            .from('profiles')
            .update({ verification_status: 'pending' })
            .eq('user_id', userId);

        // Notify admins
        const { data: admins } = await adminClient
            .from('admins')
            .select('id')
            .in('role', ['SUPER_ADMIN', 'ADMIN', 'MODERATOR']);

        if (admins?.length) {
            await adminClient.from('notifications').insert(
                admins.map(a => ({
                    user_id: a.id,
                    title: 'New Identity Verification Request',
                    content: `A user has submitted identity verification documents for review.`,
                    type: 'SYSTEM',
                    link: '/admin/verification'
                }))
            );
        }

        res.status(201).json({ success: true, data, message: 'Verification submitted successfully. We will review within 1-3 business days.' });
    } catch (err) {
        next(err);
    }
};

// POST /api/identity/upload — upload document image to storage
exports.uploadDocument = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const file = req.file;

        if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const ext = file.originalname.split('.').pop().toLowerCase();
        const allowed = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
        if (!allowed.includes(ext)) {
            return res.status(400).json({ success: false, message: 'Only JPG, PNG, WebP or PDF allowed' });
        }

        const fileName = `${userId}/${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

        const { error } = await adminClient.storage
            .from('identity-documents')
            .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

        if (error) throw error;

        // Generate a signed URL valid for 7 days (private bucket)
        const { data: signedData, error: signErr } = await adminClient.storage
            .from('identity-documents')
            .createSignedUrl(fileName, 60 * 60 * 24 * 7);

        if (signErr) throw signErr;

        res.status(200).json({ success: true, data: { url: signedData.signedUrl, path: fileName } });
    } catch (err) {
        next(err);
    }
};

// ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

// GET /api/identity/admin/pending — list pending verifications (admin only)
exports.getPendingVerifications = async (req, res, next) => {
    try {
        const { status = 'PENDING', role, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let query = adminClient
            .from('identity_verifications')
            .select('*', { count: 'exact' });
        
        if (status !== 'ALL') {
            query = query.eq('status', status.toUpperCase());
        }

        // Filter by user_role (CLIENT or FREELANCER)
        if (role) {
            query = query.eq('user_role', role.toUpperCase());
        }

        const { data, error, count } = await query
            .order('submitted_at', { ascending: true })
            .range(offset, offset + Number(limit) - 1);

        if (error) throw error;

        // Enrichment logic for identity verification
        const userIds = (data || []).map(v => v.user_id);
        const { data: profiles } = userIds.length
            ? await adminClient.from('profiles').select('user_id, name, email, avatar_url').in('user_id', userIds)
            : { data: [] };
        const pm = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        // Refresh signed URLs for document viewing
        const enriched = await Promise.all((data || []).map(async (v) => {
            const refreshUrl = async (url) => {
                if (!url) return null;
                try {
                    // Extract path from signed URL - handle both signed and regular URLs
                    let path = null;
                    const signedMatch = url.match(/\/identity-documents\/(.+?)(?:\?|$)/);
                    if (signedMatch) path = signedMatch[1];
                    if (!path) return url;

                    const { data: signed } = await adminClient.storage
                        .from('identity-documents')
                        .createSignedUrl(decodeURIComponent(path), 60 * 60 * 24);
                    return signed?.signedUrl || url;
                } catch (_) {
                    return url; // return original if refresh fails
                }
            };

            return {
                ...v,
                user: { id: v.user_id, email: pm[v.user_id]?.email || '' },
                profile: pm[v.user_id] || null,
                document_front_url: await refreshUrl(v.document_front_url),
                document_back_url: await refreshUrl(v.document_back_url),
                selfie_url: await refreshUrl(v.selfie_url)
            };
        }));

        res.status(200).json({ success: true, data: enriched, pagination: { total: count || 0, page: Number(page), limit: Number(limit) } });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/identity/admin/:id/review — approve or reject (admin only)
exports.reviewVerification = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { id } = req.params;
        const { action, rejection_reason } = req.body; // action: 'approve' | 'reject'

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'action must be approve or reject' });
        }
        if (action === 'reject' && !rejection_reason?.trim()) {
            return res.status(400).json({ success: false, message: 'rejection_reason is required when rejecting' });
        }

        const { data: verification } = await adminClient
            .from('identity_verifications')
            .select('id, user_id, status')
            .or(`id.eq.${id},user_id.eq.${id}`)
            .maybeSingle();

        if (!verification) return res.status(404).json({ success: false, message: 'Verification not found' });

        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        const { data, error } = await adminClient
            .from('identity_verifications')
            .update({
                status: newStatus,
                rejection_reason: action === 'reject' ? rejection_reason.trim() : null,
                reviewed_by: adminId,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', verification.id)
            .select()
            .single();

        if (error) throw error;

        // Update profile
        await adminClient.from('profiles').update({
            is_verified: action === 'approve',
            verification_status: action === 'approve' ? 'verified' : 'rejected'
        }).eq('user_id', verification.user_id);

        // Notify user
        await adminClient.from('notifications').insert([{
            user_id: verification.user_id,
            title: action === 'approve' ? '✅ Identity Verified!' : '❌ Identity Verification Rejected',
            content: action === 'approve'
                ? 'Your identity has been verified. You now have an IDV badge on your profile.'
                : `Your identity verification was rejected. Reason: ${rejection_reason}`,
            type: 'SYSTEM',
            link: '/freelancer/profile'
        }]);

        res.status(200).json({ success: true, data, message: `Verification ${newStatus.toLowerCase()}` });
    } catch (err) {
        next(err);
    }
};
