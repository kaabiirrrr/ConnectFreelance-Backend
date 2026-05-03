const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const deliveryService = require('../services/deliveryService');
const relationshipService = require('../services/relationshipService');

/**
 * GET UPLOAD URL
 * Generates a signed URL for direct-to-storage upload.
 */
exports.getUploadUrl = async (req, res, next) => {
    try {
        const { fileName, fileSize, fileType } = req.body;
        const freelancerId = req.user.id;

        // 1. Validation
        const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
        if (fileSize > MAX_SIZE) {
            return res.status(400).json({ success: false, message: 'File too large (Max 5GB)' });
        }

        const allowedExtensions = ['zip', 'pdf', 'png', 'jpg', 'jpeg', 'mp4', 'docx'];
        const ext = fileName.split('.').pop().toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return res.status(400).json({ success: false, message: `Extension .${ext} not allowed` });
        }

        // 2. Generate path: {jobId}/{freelancerId}/pending/{timestamp}-{fileName}
        // Simplified path (no redundant bucket name prefix)
        const { jobId } = req.body;
        const path = `${jobId || 'misc'}/${freelancerId}/pending/${Date.now()}-${fileName}`;

        // 3. Create Signed URL (valid for 30 mins)
        const { data, error } = await adminClient.storage
            .from('deliveries')
            .createSignedUploadUrl(path);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: {
                signedUrl: data.signedUrl,
                path: path,
                token: data.token
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * SUBMIT WORK
 * Creates the delivery record and files.
 */
exports.submitWork = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { contract_id, message, work_link, files, delivery_type } = req.body;

        // 1. Hard RBAC & Contract Validation
        const { data: contract, error: contractErr } = await adminClient
            .from('contracts')
            .select('*, jobs(title)')
            .eq('id', contract_id)
            .single();

        if (contractErr || !contract) return res.status(404).json({ success: false, message: 'Contract not found' });
        if (contract.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Only the assigned freelancer can submit work' });
        
        // 2. Lock Check: Block if completed or last approved
        if (contract.status === 'COMPLETED') return res.status(400).json({ success: false, message: 'Contract is completed and locked' });

        const { data: lastDelivery } = await adminClient
            .from('deliveries')
            .select('status, version')
            .eq('contract_id', contract_id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastDelivery && lastDelivery.status === 'approved') {
            return res.status(400).json({ success: false, message: 'Work already approved. Submission locked.' });
        }
        
        // 3. Spam Prevention: if 'submitted' and not reviewed
        if (lastDelivery && lastDelivery.status === 'submitted') {
            return res.status(400).json({ success: false, message: 'A submission is already pending review.' });
        }

        // 4. Link Security
        if (work_link) {
            try {
                const url = new URL(work_link);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
            } catch {
                return res.status(400).json({ success: false, message: 'Invalid or unsafe work link provided' });
            }
        }

        // 5. AI Validation (Advisory)
        const aiResult = await deliveryService.validateSubmissionWithAI(message, work_link, delivery_type);
        // We no longer block the submission unless it's completely empty (which is handled by standard validation)
        // This allows freelancers to submit even if the AI score is low, but the score is recorded.

        // 6. DB Insertion (Atomic Versioning via transaction logic inside one call if possible)
        const nextVersion = (lastDelivery?.version || 0) + 1;

        const { data: delivery, error: deliveryErr } = await adminClient
            .from('deliveries')
            .insert([{
                job_id: contract.job_id,
                contract_id,
                freelancer_id: freelancerId,
                client_id: contract.client_id,
                message,
                work_link,
                delivery_type,
                version: nextVersion,
                revision_count: lastDelivery ? (lastDelivery.status === 'revision_requested' ? 1 : 0) : 0,
                status: 'submitted',
                first_submission_time: lastDelivery ? undefined : new Date()
            }])
            .select()
            .single();

        if (deliveryErr) throw deliveryErr;

        // 7. Insert Files
        if (files && files.length > 0) {
            const filesToInsert = files.map(f => ({
                delivery_id: delivery.id,
                file_url: f.url,
                file_name: f.name,
                file_size: f.size,
                file_type: f.type,
                file_hash: f.hash
            }));
            await adminClient.from('delivery_files').insert(filesToInsert);
        }

        // 8. Performance Tracking: Update member stats
        await adminClient
            .from('job_members')
            .update({ 
                last_delivery_at: new Date() 
            })
            .eq('job_id', contract.job_id)
            .eq('user_id', freelancerId);

        // 9. Event / Notification
        await deliveryService.emitDeliveryEvent('SUBMITTED', { delivery, contract });

        res.status(201).json({ 
            success: true, 
            data: delivery, 
            aiFeedback: aiResult.feedback,
            message: 'Work delivered successfully' 
        });

    } catch (err) {
        logger.error('[SubmitWork Error]', err);
        next(err);
    }
};

/**
 * APPROVE WORK
 */
exports.approveWork = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { id } = req.params;

        // 1. Fetch & Verify
        const { data: delivery, error: delErr } = await adminClient
            .from('deliveries')
            .select('*, contracts(*)')
            .eq('id', id)
            .single();

        if (delErr || !delivery) return res.status(404).json({ success: false, message: 'Delivery not found' });
        if (delivery.client_id !== clientId) return res.status(403).json({ success: false, message: 'Only the client can approve work' });

        if (delivery.status !== 'submitted') return res.status(400).json({ success: false, message: 'Can only approve "submitted" work' });

        // 2. Perform Update
        const { data, error } = await adminClient
            .from('deliveries')
            .update({ 
                status: 'approved',
                final_approval_time: new Date()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 3. Auto-Complete Contract (Finalizing the relationship)
        await adminClient.from('contracts').update({ status: 'COMPLETED' }).eq('id', delivery.contract_id);

        // 4. Sync Relationship Stats (Trust Graph v2)
        relationshipService.syncRelationshipStats(delivery.client_id, delivery.freelancer_id).catch(err => {
            logger.error('[RelationshipSync] Failed in approveWork', err);
        });

        // 5. Notification
        await deliveryService.emitDeliveryEvent('APPROVED', { delivery: data, contract: delivery.contracts });

        res.status(200).json({ success: true, data, message: 'Work approved and contract finalized' });

    } catch (err) {
        next(err);
    }
};

/**
 * REQUEST REVISION
 */
exports.requestRevision = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { id } = req.params;
        const { feedback } = req.body;

        const { data: delivery, error: delErr } = await adminClient
            .from('deliveries')
            .select('*, contracts(*)')
            .eq('id', id)
            .single();

        if (delErr || !delivery) return res.status(404).json({ success: false, message: 'Delivery not found' });
        if (delivery.client_id !== clientId) return res.status(403).json({ success: false, message: 'Only the client can request revisions' });

        // 1. Update status
        const { data, error } = await adminClient
            .from('deliveries')
            .update({ status: 'revision_requested' })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 2. Add as comment if feedback provided
        if (feedback) {
            await adminClient.from('delivery_comments').insert([{
                delivery_id: id,
                user_id: clientId,
                comment: feedback
            }]);
        }

        // 3. Increment revision count on current delivery record
        await adminClient.rpc('increment_revision_count', { delivery_id: id });

        // 4. Notification
        await deliveryService.emitDeliveryEvent('REVISION_REQUESTED', { delivery: data, contract: delivery.contracts });

        res.status(200).json({ success: true, data, message: 'Revision requested' });

    } catch (err) {
        next(err);
    }
};

/**
 * GET DELIVERIES
 */
exports.getDeliveriesByJob = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        // 1. Fetch Job Members for metadata and role-info (Resilient Fallback)
        let members = [];
        try {
            const { data: mData, error: mErr } = await adminClient
                .from('job_members')
                .select('*')
                .eq('job_id', jobId)
                .eq('status', 'active');
            
            if (!mErr && mData && mData.length > 0) {
                members = mData;
            } else {
                // FALLBACK: Derive from contracts if job_members is missing/empty (Enterprise Workspace not initialized)
                const { data: cData } = await adminClient
                    .from('contracts')
                    .select('freelancer_id, created_at')
                    .eq('job_id', jobId)
                    .eq('status', 'ACTIVE');
                
                if (cData) {
                    members = cData.map(c => ({
                        user_id: c.freelancer_id,
                        role: 'Task Specialist',
                        status: 'active',
                        joined_at: c.created_at
                    }));
                }
            }
        } catch (e) {
            console.error('[Deliveries] Members fallback error:', e.message);
        }

        // 2. Fetch Deliveries
        const { data, error } = await adminClient
            .from('deliveries')
            .select(`
                *,
                delivery_files (*),
                delivery_comments (*, profiles!delivery_comments_user_id_profiles_fkey(name, avatar_url))
            `)
            .eq('job_id', jobId)
            .order('version', { ascending: false });

        if (error) throw error;

        // 3. Authorization & Filtering
        if (userRole === 'CLIENT') {
            // Verify client ownership
            const { data: job } = await adminClient.from('jobs').select('client_id').eq('id', jobId).single();
            if (!job || job.client_id !== userId) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }

            // Group by freelancer_id for structured client view
            const grouped = {};
            (data || []).forEach(d => {
                if (!grouped[d.freelancer_id]) {
                    const member = (members || []).find(m => m.user_id === d.freelancer_id);
                    grouped[d.freelancer_id] = {
                        freelancer_id: d.freelancer_id,
                        role: member?.role || 'Contributor',
                        deliveries: []
                    };
                }
                grouped[d.freelancer_id].deliveries.push(d);
            });

            return res.status(200).json({ success: true, data: data, grouped });
        } else if (userRole === 'FREELANCER') {
            // Strict Isolation: Only see own work
            const authorized = data.filter(d => d.freelancer_id === userId);
            
            // Check if user is actually a member of this job
            const isMember = (members || []).some(m => m.user_id === userId);
            if (!isMember && authorized.length === 0) {
                return res.status(403).json({ success: false, message: 'Assign yourself to this job first' });
            }

            return res.status(200).json({ success: true, data: authorized });
        }

        res.status(403).json({ success: false, message: 'Unauthorized role' });
    } catch (err) {
        next(err);
    }
};

/**
 * GET SIGNED URL
 * Generates a signed URL for a file in the 'deliveries' bucket.
 * Includes "Auto-Healing" logic and forces a download with the original filename.
 */
exports.getSignedUrl = async (req, res, next) => {
    try {
        let { path, fileName } = req.query;
        if (!path) return res.status(400).json({ success: false, message: 'File path is required' });

        // Backup: extract filename from path if not provided
        if (!fileName) {
            const parts = path.split('/');
            fileName = parts[parts.length - 1];
            // Remove the timestamp prefix (e.g. 12345678-name.png -> name.png)
            if (fileName.includes('-')) {
                const subParts = fileName.split('-');
                if (subParts.length > 1) fileName = subParts.slice(1).join('-');
            }
        }

        const options = { download: fileName || true };

        // --- Auto-Healing Logic ---
        
        // 1. Try raw path exactly as provided
        console.log(`[Storage] Creating signed URL for path: ${path}`);
        let { data, error } = await adminClient.storage
            .from('deliveries')
            .createSignedUrl(path, 3600, options);

        // 2. If not found (404), try stripping 'deliveries/' prefix (legacy check)
        if (error && (error.status === 404 || error.message?.toLowerCase().includes('not found') || error.message?.toLowerCase().includes('does not exist'))) {
            const cleanPath = path.startsWith('deliveries/') ? path.replace('deliveries/', '') : path;
            
            if (cleanPath !== path) {
                console.log(`[Storage] Retrying with clean path: ${cleanPath}`);
                const retry = await adminClient.storage
                    .from('deliveries')
                    .createSignedUrl(cleanPath, 3600, options);
                
                data = retry.data;
                error = retry.error;
            }
        }

        // 3. If still not found, try adding 'deliveries/' prefix (reverse check)
        if (error && (error.status === 404 || error.message?.toLowerCase().includes('not found') || error.message?.toLowerCase().includes('does not exist'))) {
            const prefixedPath = path.startsWith('deliveries/') ? path : `deliveries/${path}`;
            
            if (prefixedPath !== path) {
                console.log(`[Storage] Retrying with prefixed path: ${prefixedPath}`);
                const retry = await adminClient.storage
                    .from('deliveries')
                    .createSignedUrl(prefixedPath, 3600, options);
                
                data = retry.data;
                error = retry.error;
            }
        }

        if (error) {
            console.error(`[Storage] Final error for path ${path}:`, error);
            return res.status(error.status || 404).json({
                success: false,
                message: `Storage Error: ${error.message || 'File not found'}`
            });
        }

        res.status(200).json({
            success: true,
            data: { signedUrl: data.signedUrl }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * DOWNLOAD FILE (PROXIED)
 * Downloads a file from Supabase and streams it to the client.
 * This ensures correct Content-Disposition (filename) is set by our backend.
 */
exports.downloadFile = async (req, res, next) => {
    try {
        let { path, fileName } = req.query;
        if (!path) return res.status(400).json({ success: false, message: 'File path is required' });

        // Backup: extract filename from path if not provided
        if (!fileName) {
            const parts = path.split('/');
            fileName = parts[parts.length - 1];
            if (fileName.includes('-')) {
                const subParts = fileName.split('-');
                if (subParts.length > 1) fileName = subParts.slice(1).join('-');
            }
        }

        // --- Auto-Healing Logic ---
        let currentPath = path;
        let { data, error } = await adminClient.storage.from('deliveries').download(currentPath);

        // Try stripping 'deliveries/' prefix
        if (error && (error.status === 404 || error.message?.toLowerCase().includes('not found'))) {
            const cleanPath = path.startsWith('deliveries/') ? path.replace('deliveries/', '') : path;
            if (cleanPath !== path) {
                const retry = await adminClient.storage.from('deliveries').download(cleanPath);
                if (!retry.error) { data = retry.data; error = null; currentPath = cleanPath; }
            }
        }

        // Try adding 'deliveries/' prefix
        if (error && (error.status === 404 || error.message?.toLowerCase().includes('not found'))) {
            const prefixedPath = path.startsWith('deliveries/') ? path : `deliveries/${path}`;
            if (prefixedPath !== path) {
                const retry = await adminClient.storage.from('deliveries').download(prefixedPath);
                if (!retry.error) { data = retry.data; error = null; currentPath = prefixedPath; }
            }
        }

        if (error) {
            console.error(`[Download Error] Path: ${path}`, error);
            return res.status(error.status || 404).json({ success: false, message: 'File not found' });
        }

        // --- Mime Type Sniffing ---
        let contentType = 'application/octet-stream';
        const ext = fileName.split('.').pop().toLowerCase();
        const mimeMap = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'pdf': 'application/pdf',
            'zip': 'application/zip',
            'txt': 'text/plain',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword'
        };
        if (mimeMap[ext]) contentType = mimeMap[ext];

        // Set headers to force download and preserve filename
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        // Convert Blob to Buffer for sending
        const buffer = Buffer.from(await data.arrayBuffer());
        
        res.send(buffer);

    } catch (err) {
        console.error('[Download Controller Error]', err);
        next(err);
    }
};

/**
 * ADD COMMENT
 */
exports.addComment = async (req, res, next) => {
    try {
        const { id: deliveryId } = req.params;
        const { comment } = req.body;
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('delivery_comments')
            .insert([{
                delivery_id: deliveryId,
                user_id: userId,
                comment
            }])
            .select('*, profiles!delivery_comments_user_id_profiles_fkey(name, avatar_url)')
            .single();

        if (error) throw error;

        res.status(201).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
