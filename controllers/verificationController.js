const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

// GET /api/verification/me — Get current verification status
exports.getMe = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('identity_verifications')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        res.status(200).json({
            success: true,
            status: data?.status || 'NOT_STARTED',
            data: data || null
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/verification/extract — Simulate OCR extraction
exports.extract = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { imageUrl, documentType } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, message: 'imageUrl is required' });
        }

        // Fetch user profile to "simulate" OCR finding their name
        const { data: profile } = await adminClient
            .from('profiles')
            .select('name')
            .eq('user_id', userId)
            .single();

        // Simulate a 1.5s delay for "AI Analysis"
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Mock data extraction
        const mockData = {
            name: profile?.name || 'Full Name From ID',
            dob: '01/01/1990',
            gender: 'Male',
            idNumber: documentType === 'aadhaar' ? 'XXXX-XXXX-1234' : 'A1234567'
        };

        res.status(200).json({
            success: true,
            data: mockData,
            message: 'Data extracted successfully (simulated)'
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/verification/submit — Submit final verification data
exports.submit = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const {
            userType,
            documentType,
            documentUrl,
            documentBackUrl,
            extractedName,
            extractedDob,
            extractedGender,
            aadhaarNumber,
            panNumber,
            dlNumber
        } = req.body;

        if (!documentType || !documentUrl) {
            return res.status(400).json({ success: false, message: 'documentType and documentUrl are required' });
        }

        // Check if already approved
        const { data: existing } = await adminClient
            .from('identity_verifications')
            .select('status')
            .eq('user_id', userId)
            .maybeSingle();

        if (existing?.status === 'APPROVED') {
            return res.status(400).json({ success: false, message: 'You are already verified.' });
        }

        // Construct document number
        const idNumber = aadhaarNumber || panNumber || dlNumber || 'N/A';

        // Upsert verification record
        const { data, error } = await adminClient
            .from('identity_verifications')
            .upsert([{
                user_id: userId,
                status: 'PENDING',
                document_type: documentType,
                document_front_url: documentUrl,
                document_back_url: documentBackUrl || null,
                extracted_name: extractedName,
                extracted_dob: extractedDob,
                extracted_gender: extractedGender,
                document_number: idNumber,
                submitted_at: new Date().toISOString(),
                user_role: userType?.toUpperCase()
            }], { onConflict: 'user_id' })
            .select()
            .single();

        if (error) {
            logger.error('[VerificationController] Submit failed:', error);
            return res.status(500).json({ status: 'ERROR', message: error.message });
        }

        // Update profile status
        await adminClient
            .from('profiles')
            .update({ 
                verification_status: 'pending'
            })
            .eq('user_id', userId);

        res.status(201).json({
            success: true,
            data,
            message: 'Verification submitted for review.'
        });
    } catch (err) {
        next(err);
    }
};

// ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

// GET /api/verification/admin — List verifications for admin review
exports.getAdminVerifications = async (req, res, next) => {
    try {
        const { type, status = 'PENDING' } = req.query;

        let query = adminClient
            .from('identity_verifications')
            .select(`
                *,
                user:users!user_id (
                    email
                ),
                profile:profiles!user_id (
                    name,
                    avatar_url
                )
            `);

        if (status && status !== 'ALL') {
            query = query.eq('status', status.toUpperCase());
        }

        if (type) {
            query = query.eq('user_role', type.toUpperCase());
        }

        const { data, error } = await query.order('submitted_at', { ascending: false });

        if (error) {
            logger.error('[VerificationController] getAdminVerifications error:', error);
            // Specifically check for missing column error to provide better feedback
            if (error.code === '42703') {
                return res.status(500).json({ 
                    status: 'ERROR', 
                    message: 'Database schema mismatch. Please ensure the identity_verifications table has the user_role column.',
                    error: error.message
                });
            }
            throw error;
        }

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/verification/admin/:id/approve — Approve verification
exports.approveVerification = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 1. Update verification record
        const { data: verification, error: vError } = await adminClient
            .from('identity_verifications')
            .update({
                status: 'APPROVED',
                reviewed_at: new Date().toISOString(),
                reviewed_by: adminId
            })
            .eq('user_id', id)
            .select()
            .single();

        if (vError) throw vError;

        // 2. Update profile
        await adminClient
            .from('profiles')
            .update({
                is_verified: true,
                verification_status: 'verified'
            })
            .eq('user_id', verification.user_id);

        // 3. Notify user
        await adminClient.from('notifications').insert([{
            user_id: verification.user_id,
            title: '✅ Identity Verified',
            content: 'Your identity has been successfully verified! Your IDV badge is now active.',
            type: 'SYSTEM',
            link: '/dashboard'
        }]);

        res.status(200).json({
            success: true,
            message: 'Verification approved successfully'
        });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/verification/admin/:id/reject — Reject verification
exports.rejectVerification = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason = 'Documents were unclear or invalid.' } = req.body;
        const adminId = req.user.id;

        // 1. Update verification record
        const { data: verification, error: vError } = await adminClient
            .from('identity_verifications')
            .update({
                status: 'REJECTED',
                rejection_reason: reason,
                reviewed_at: new Date().toISOString(),
                reviewed_by: adminId
            })
            .eq('user_id', id)
            .select()
            .single();

        if (vError) throw vError;

        // 2. Update profile
        await adminClient
            .from('profiles')
            .update({
                is_verified: false,
                verification_status: 'rejected'
            })
            .eq('user_id', verification.user_id);

        // 3. Notify user
        await adminClient.from('notifications').insert([{
            user_id: verification.user_id,
            title: '❌ Identity Verification Rejected',
            content: `Your verification was rejected. Reason: ${reason}`,
            type: 'SYSTEM',
            link: '/freelancer/identity-verification'
        }]);

        res.status(200).json({
            success: true,
            message: 'Verification rejected'
        });
    } catch (err) {
        next(err);
    }
};
