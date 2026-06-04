const logger = require('../utils/logger');
const { calculateReliabilityScore } = require('../utils/reliabilityCalculator');
const { predictRisk } = require('../utils/riskPredictor');
const supabase = require('../supabase/adminClient');
const matchService = require('../services/matchService');
const moderationService = require('../services/moderationService');
const enforcementService = require('../services/enforcementService');
const connectsService = require('../services/connectsService');
const notificationHelper = require('../utils/notificationHelper');



const updateRoleAnalytics = async (roleId) => {
    try {
        const { data: proposals, error } = await supabase
            .from('proposals')
            .select('proposed_rate')
            .eq('role_id', roleId)
            .eq('status', 'PENDING');

        if (error) throw error;

        const total_bids = proposals.length;
        if (total_bids === 0) {
            await supabase.from('job_roles').update({
                total_bids: 0,
                avg_bid: 0,
                best_bid: 0
            }).eq('id', roleId);
            return;
        }

        const sum = proposals.reduce((acc, p) => acc + parseFloat(p.proposed_rate), 0);
        const avg_bid = sum / total_bids;
        const best_bid = Math.min(...proposals.map(p => parseFloat(p.proposed_rate)));

        await supabase.from('job_roles').update({
            total_bids,
            avg_bid: parseFloat(avg_bid.toFixed(2)),
            best_bid: parseFloat(best_bid.toFixed(2))
        }).eq('id', roleId);
    } catch (err) {
        logger.error('[Proposals] Failed to update role analytics', err);
    }
};

exports.submitProposal = async (req, res, next) => {
    try {
        const { job_id, role_id, cover_letter, proposed_rate, estimated_duration, attachments = [] } = req.body;
        const freelancerId = req.user.id;

        // 1. Validate role exists and is open
        const { data: role, error: roleErr } = await supabase
            .from('job_roles')
            .select('status, positions, filled_positions, budget, bid_deadline')
            .eq('id', role_id)
            .single();

        if (roleErr || !role) return res.status(404).json({ success: false, message: 'Selected role not found' });
        if (role.status === 'filled') return res.status(400).json({ success: false, message: 'This role is already fully filled' });
        if (role.bid_deadline && new Date() > new Date(role.bid_deadline)) {
            return res.status(400).json({ success: false, message: 'Bidding deadline for this role has passed' });
        }

        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('status, client_id, title, is_bidding_open')
            .eq('id', job_id)
            .single();

        if (jobError || !job) return res.status(404).json({ success: false, message: 'Job not found' });
        if (!job.is_bidding_open || job.status === 'CLOSED') return res.status(400).json({ success: false, message: 'Bidding is closed for this job' });

        // 1.5 Prevent Bidding on Already Filled Roles
        if (role_id) {
            const { data: roleData } = await supabase.from('job_roles').select('positions, filled_positions').eq('id', role_id).single();
            if (roleData && roleData.filled_positions >= roleData.positions) {
                return res.status(400).json({ success: false, message: 'This specific role has already been filled' });
            }
        }


        // 2. Prevent Duplicate Proposals per role
        const { data: existingProposal } = await supabase
            .from('proposals')
            .select('id')
            .eq('job_id', job_id)
            .eq('freelancer_id', freelancerId)
            .maybeSingle();

        if (existingProposal) {
            return res.status(409).json({ success: false, message: 'You have already submitted a proposal for this project' });
        }

        // 2.5 Connect Deduction
        try {
            await connectsService.handleConnectDeduction(freelancerId, 'proposal_submit');
        } catch (err) {
            return res.status(403).json({ success: false, message: err.message });
        }
        
        // --- CONTACT PROTECTION INJECTION (v2) ---
        if (cover_letter) {
            const moderation = await moderationService.moderate(cover_letter, freelancerId);
            if (moderation.blocked) {
                // Process enforcement
                const enforcement = await enforcementService.processViolation(freelancerId, {
                    ...moderation,
                    message: cover_letter
                });

                return res.status(403).json({
                    success: false,
                    message: `Proposal blocked: ${moderation.reason}`,
                    action: enforcement.action,
                    strikes: enforcement.strikes,
                    flagged_content: cover_letter
                });

            }
        }



        // 3. Insert Proposal
        const { data: proposal, error: insertError } = await supabase
            .from('proposals')
            .insert([{
                job_id,
                role_id,
                freelancer_id: freelancerId,
                cover_letter: cover_letter.trim(),
                proposed_rate: parseFloat(proposed_rate),
                bid_amount: parseFloat(proposed_rate),
                estimated_duration: estimated_duration?.trim() || 'Not specified',
                status: 'PENDING',
                attachments: Array.isArray(attachments) ? attachments : []
            }])
            .select('*')
            .single();

        if (insertError) throw insertError;

        // 4. Increment proposal_count on jobs table
        try {
            const { data: jobRow } = await supabase
                .from('jobs')
                .select('proposal_count')
                .eq('id', job_id)
                .maybeSingle();

            await supabase
                .from('jobs')
                .update({ proposal_count: (jobRow?.proposal_count || 0) + 1 })
                .eq('id', job_id);
        } catch (_) {}

        // 5. Update Role Analytics
        await updateRoleAnalytics(role_id);

        // 5. Notifications & Real-time
        try {
            await supabase.from('notifications').insert([{
                user_id: job.client_id,
                title: 'New Bid Received',
                content: `A freelancer bid on the "${role.title || 'General'}" role for your job: "${job.title}"`,
                type: 'PROPOSAL',
                link: `/client/job/${job_id}`
            }]);
            
            getIO().to(`room:user:${job.client_id}`).emit('new-proposal', { ...proposal, job_title: job.title });
            getIO().to(`room:job:${job_id}`).emit('proposal_submitted', { role_id, freelancer_id: freelancerId });

            // Send email notification based on preferences
            try {
                const { data: fProfile } = await supabase.from('profiles').select('name').eq('user_id', freelancerId).maybeSingle();
                const freelancerName = fProfile?.name || 'A freelancer';
                await notificationHelper.checkAndSendNotification(job.client_id, 'email_proposals', {
                    jobTitle: job.title,
                    freelancerName: freelancerName
                });
            } catch (err) {
                logger.error('[Notifications] Email proposal dispatch failed', err.message);
            }
        } catch (_) {}

        res.status(201).json({ success: true, data: proposal, message: "Proposal submitted successfully" });

        // 6. Trigger AI Matching Engine (Background)
        if (role_id) {
            await matchService.invalidateRoleCache(role_id);
            matchService.recalculateRoleMatches(role_id);
        }

    } catch (error) {
        logger.error("Submit proposal error", error);
        next(error);
    }
};



exports.withdrawProposal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const freelancerId = req.user.id;

        const { data: proposal, error: propError } = await supabase
            .from('proposals')
            .select('id, freelancer_id, role_id')
            .eq('id', id)
            .single();

        if (propError || !proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
        if (proposal.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { error } = await supabase.from('proposals').delete().eq('id', id);
        if (error) throw error;

        // Sync Analytics
        if (proposal.role_id) await updateRoleAnalytics(proposal.role_id);

        res.status(200).json({ success: true, message: 'Proposal withdrawn successfully' });

        // Sync Matching Engine
        if (proposal.role_id) {
            await matchService.invalidateRoleCache(proposal.role_id);
            matchService.recalculateRoleMatches(proposal.role_id).catch(() => {});
        }

    } catch (error) {
        next(error);
    }
};


// Also helpful for a client to accept a proposal implicitly or explicitly
exports.acceptProposal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const clientId = req.user.id;

        // 1. Fetch proposal with job and role info
        const { data: proposal, error: fetchError } = await supabase
            .from('proposals')
            .select(`
                id, job_id, role_id, freelancer_id, proposed_rate, status,
                job:jobs(client_id, title, job_mode),
                role:job_roles(id, title, positions, filled_positions, status)
            `)
            .eq('id', id)
            .maybeSingle();

        if (fetchError || !proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
        
        const job = Array.isArray(proposal.job) ? proposal.job[0] : proposal.job;
        const role = Array.isArray(proposal.role) ? proposal.role[0] : proposal.role;

        if (job?.client_id !== clientId) return res.status(403).json({ success: false, message: 'Not authorized' });
        if (proposal.status === 'ACCEPTED') return res.status(400).json({ success: false, message: 'Proposal already accepted' });
        if (!role || role.status === 'filled') return res.status(400).json({ success: false, message: 'Role is already filled' });

        // 1.5 Connect Deduction (Client)
        try {
            await connectsService.handleConnectDeduction(clientId, 'proposal_accept');
        } catch (err) {
            return res.status(403).json({ success: false, message: err.message });
        }

        // 2. ESCROW VALIDATION (STRICT)
        const { data: escrow } = await supabase
            .from('payments')
            .select('status')
            .eq('job_id', proposal.job_id)
            .eq('role_id', proposal.role_id)
            .eq('type', 'escrow')
            .maybeSingle();

        // if (!escrow || escrow.status !== 'funded') {
        //     return res.status(400).json({ success: false, message: 'Hiring blocked: Escrow for this role must be funded first.' });
        // }

        // 3. ATOMIC HIRE (Use RPC for internal transaction and row-level locking)
        const { data: result, error: rpcError } = await adminClient.rpc('handle_proposal_acceptance', {
            target_proposal_id: id,
            target_role_id: proposal.role_id,
            target_job_id: proposal.job_id,
            target_freelancer_id: proposal.freelancer_id,
            target_client_id: clientId,
            agreed_rate: proposal.proposed_rate
        });

        if (rpcError) {
            logger.error('[Proposals] Atomic acceptance failed', rpcError);
            return res.status(400).json({ success: false, message: rpcError.message || 'Acceptance failed' });
        }

        // 4. AUTO ESCROW: Move proposed_rate from available_balance to pending_balance
        try {
            const amount = parseFloat(proposal.proposed_rate) || 0;
            if (amount > 0) {
                const { data: wallet } = await adminClient
                    .from('wallets')
                    .select('available_balance, pending_balance')
                    .eq('user_id', clientId)
                    .maybeSingle();

                if (wallet && parseFloat(wallet.available_balance) >= amount) {
                    await adminClient
                        .from('wallets')
                        .update({
                            available_balance: parseFloat(wallet.available_balance) - amount,
                            pending_balance: parseFloat(wallet.pending_balance) + amount,
                            updated_at: new Date().toISOString()
                        })
                        .eq('user_id', clientId);
                }
            }
        } catch (escrowErr) {
            logger.warn('[Proposals] Auto-escrow move failed (non-blocking):', escrowErr.message);
        }

        // 5. Notifications & UI Events
        try {
            getIO().to(`room:user:${proposal.freelancer_id}`).emit('proposal-status-changed', {
                proposal_id: id,
                status: 'ACCEPTED',
                job_title: job.title
            });
            
            if (result.job_closed) {
                getIO().to(`room:job:${proposal.job_id}`).emit('job_closed', { job_id: proposal.job_id });
            }
        } catch (_) {}

        res.status(200).json({
            success: true,
            data: result,
            message: 'Proposal accepted successfully'
        });
    } catch (error) {
        logger.error('Error in acceptProposal', error);
        next(error);
    }
};


// Get proposals for a specific job (client)
exports.getJobProposals = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const clientId = req.user.id;

        // Verify job ownership
        const { data: job } = await supabase.from('jobs').select('client_id').eq('id', jobId).single();
        if (!job || job.client_id !== clientId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { data, error } = await supabase
            .from('proposals')
            .select(`
                id, job_id, role_id, freelancer_id, cover_letter, proposed_rate, bid_amount,
                estimated_duration, status, created_at, attachments,
                freelancer:profiles(name, avatar_url, bio, reliability_score),
                role:job_roles(id, title, budget, positions, filled_positions)
            `)

            .eq('job_id', jobId)
            .order('bid_amount', { ascending: true });

        if (error) throw error;

        // Inject risk level for client
        const enrichedProposals = await Promise.all((data || []).map(async p => {
            const { stats } = await calculateReliabilityScore(p.freelancer_id);
            const risk = predictRisk(p.freelancer?.reliability_score || 100, stats);
            return {
                ...p,
                job_id: jobId,
                risk_assessment: {
                    level: risk.riskLevel,
                    score: risk.riskScore
                }
            };
        }));

        res.status(200).json({ success: true, data: enrichedProposals });
    } catch (error) {
        next(error);
    }
};

// Get proposals for the logged-in user (freelancer or client)
exports.getMyProposals = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role || 'FREELANCER';

        let query;
        if (role === 'CLIENT') {
            // Get all proposals on this client's jobs
            const { data: jobs } = await supabase.from('jobs').select('id').eq('client_id', userId);
            const jobIds = (jobs || []).map(j => j.id);
            if (jobIds.length === 0) return res.status(200).json({ success: true, data: [] });
            query = supabase.from('proposals').select(`
                id, job_id, role_id, freelancer_id, cover_letter, proposed_rate, bid_amount, status, created_at,
                freelancer:profiles(name, avatar_url, is_verified, reliability_score), 
                job:jobs(title, category, budget_amount, budget_type, bid_deadline),
                role:job_roles(id, title, budget, positions, filled_positions)
            `).in('job_id', jobIds)


            .order('bid_amount', { ascending: true });
        } else {
            query = supabase.from('proposals').select(`
                id, job_id, freelancer_id, proposed_rate, bid_amount, cover_letter, estimated_duration, status, created_at, updated_at,
                job:jobs(title, budget_amount, budget_type, status, experience_level, category, bid_deadline, client:profiles(name, avatar_url))
            `).eq('freelancer_id', userId)
            .order('created_at', { ascending: false });
        }

        const { data, error } = await query;
        if (error) throw error;

        let enrichedData = data || [];
        if (role === 'CLIENT') {
            enrichedData = await Promise.all(enrichedData.map(async p => {
                const { stats } = await calculateReliabilityScore(p.freelancer_id);
                const risk = predictRisk(p.freelancer?.reliability_score || 100, stats);
                return {
                    ...p,
                    risk_assessment: {
                        level: risk.riskLevel,
                        score: risk.riskScore
                    }
                };
            }));
        }

        res.status(200).json({ success: true, data: enrichedData });
    } catch (error) {
        next(error);
    }
};

// Update proposal status (client accept/reject)
exports.updateProposalStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, role = 'Freelancer' } = req.body;
        const clientId = req.user.id;

        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const upperStatus = status.toUpperCase();

        if (!['ACCEPTED', 'REJECTED'].includes(upperStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid status. Must be accepted or rejected' });
        }

        // Fetch proposal with job info
        const { data: proposal, error: fetchError } = await supabase
            .from('proposals')
            .select(`
                id, job_id, role_id, freelancer_id, proposed_rate, status,
                job:jobs(client_id, title)
            `)
            .eq('id', id)
            .maybeSingle();


        if (fetchError || !proposal) {
            return res.status(404).json({ success: false, message: 'Proposal not found' });
        }

        // Handle joined job record safely
        const job = Array.isArray(proposal.job) ? proposal.job[0] : proposal.job;
        const jobClientId = job?.client_id;
        const jobTitle = job?.title;

        if (jobClientId !== clientId) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this proposal' });
        }

        // If status is already what we want, return success (except for ACCEPTED which we want to re-verify)
        if (proposal.status === upperStatus && upperStatus !== 'ACCEPTED') {
            return res.status(200).json({ success: true, data: proposal });
        }

        // 1. Update proposal status
        const { data, error } = await supabase
            .from('proposals')
            .update({ status: upperStatus })
            .eq('id', id)
            .select('id, job_id, freelancer_id, status, proposed_rate')
            .single();

        if (error) throw new Error(`Update failed: ${error.message}`);

        // --- PRE-HIRE BALANCE CHECK (FAKE MODE) ---
        if (upperStatus === 'ACCEPTED' && process.env.ESCROW_MODE === 'FAKE') {
            const { data: wallet } = await supabase.from('wallets').select('available_balance').eq('user_id', clientId).maybeSingle();
            const available = wallet ? parseFloat(wallet.available_balance) : 10000;
            if (available < proposal.proposed_rate) {
                // Rollback status to PENDING
                await supabase.from('proposals').update({ status: 'PENDING' }).eq('id', id);
                return res.status(400).json({ 
                    success: false, 
                    message: `Insufficient demo balance. Hiring requires ₹${proposal.proposed_rate}, but you have ₹${available}. Please reset your wallet in the dashboard.` 
                });
            }
        }

        let contract = null;
        if (upperStatus === 'ACCEPTED') {
            const { scope, role = 'Freelancer' } = req.body;

            // --- MISSION CONTROL VALIDATION ---
            if (!scope || scope.trim().length < 10) {
                return res.status(400).json({ success: false, message: 'A detailed Scope of Work (Mission) is mandatory for team hiring.' });
            }

            // Check Team Limit (Max 10)
            const { count: currentMembers } = await supabase
                .from('job_members')
                .select('*', { count: 'exact', head: true })
                .eq('job_id', proposal.job_id)
                .eq('status', 'active');

            if ((currentMembers || 0) >= 10) {
                return res.status(400).json({ success: false, message: 'Max team limit reached for this project (Limit: 10).' });
            }

            // AI Validation (Groq) - Non-blocking for better UX, we rely on the 10-char basic check above
            try {
                const { validateMissionScope } = require('../utils/workspaceAIUtils');
                const aiVal = await validateMissionScope(role, scope);
                if (!aiVal.isValid && !aiVal.isFallback) {
                    logger.warn('[AI Validation] Scope flagged as vague but allowing', { role, feedback: aiVal.feedback });
                }
            } catch (aiErr) {
                logger.error('[AI Validation] Process failed', aiErr);
            }

            // Check for existing contract first
            const { data: existingContract } = await supabase
                .from('contracts')
                .select('id')
                .eq('proposal_id', id)
                .maybeSingle();

            if (existingContract) {
                contract = existingContract;
            } else {
                // 2. Create contract
                const { data: newContract, error: contractError } = await supabase
                    .from('contracts')
                    .insert([{
                        proposal_id: id,
                        job_id: proposal.job_id,
                        client_id: clientId,
                        freelancer_id: proposal.freelancer_id,
                        agreed_rate: proposal.proposed_rate,
                        status: 'ACTIVE',
                        start_date: new Date().toISOString(),
                        project_type: 'FIXED'
                    }])
                    .select('id, status, start_date')
                    .single();

                if (contractError) {
                    logger.error('[Proposals] Contract creation error', contractError);
                } else {
                    contract = newContract;

                    // --- AUTO-FUND (FAKE MODE) ---
                    if (process.env.ESCROW_MODE === 'FAKE') {
                        try {
                            await supabase.rpc('process_fake_escrow_funding', {
                                p_client_id: clientId,
                                p_freelancer_id: proposal.freelancer_id,
                                p_contract_id: newContract.id,
                                p_milestone_id: null, // Initial hire funding doesn't have a milestone yet
                                p_amount: parseFloat(proposal.proposed_rate)
                            });
                            logger.info('[Escrow] Auto-funded contract on hire', { contractId: newContract.id });
                        } catch (fundErr) {
                            logger.error('[Escrow] Auto-funding failed', fundErr);
                        }
                    }
                    
                    // --- ENTERPRISE WORKSPACE SYNC ---
                    try {
                        const isLead = (currentMembers || 0) === 0;
                        const role_normalized = (role || 'freelancer').toLowerCase().trim().replace(/\s+/g, '_');

                        // Upsert into job_members
                        const { data: member, error: mErr } = await supabase
                            .from('job_members')
                            .upsert({
                                job_id: proposal.job_id,
                                user_id: proposal.freelancer_id,
                                role,
                                role_normalized,
                                scope, // Save the mission scope
                                is_lead: isLead,
                                added_by: clientId,
                                status: 'active',
                                joined_at: new Date().toISOString()
                            }, { onConflict: 'job_id, user_id' })
                            .select()
                            .single();

                        if (!mErr && member) {
                            // Log to Scope History (Audit Trail)
                            await supabase.from('job_member_scope_history').insert({
                                job_id: proposal.job_id,
                                member_id: member.id,
                                scope: scope,
                                actor_id: clientId,
                                version: 1
                            });

                            // Log Activity
                            await supabase.from('job_member_activity').insert({
                                job_id: proposal.job_id,
                                member_id: member.id,
                                actor_id: clientId,
                                action_type: 'added',
                                new_value: `${role} - Mission Assigned`
                            });
                        }
                    } catch (syncErr) {
                        logger.error('[Proposals] Workspace sync failed', syncErr);
                    }
                }
            }

            // 3. Update job & role status sync
            try {
                // Fetch job mode to determine closure strategy
                const { data: jobMeta } = await supabase.from('jobs').select('job_mode').eq('id', proposal.job_id).single();
                
                if (proposal.role_id) {
                    // TEAM MODE: Increment role positions
                    const { data: roleData } = await supabase.from('job_roles').select('positions, filled_positions').eq('id', proposal.role_id).single();
                    const newFilled = (roleData?.filled_positions || 0) + 1;
                    
                    await supabase.from('job_roles').update({ 
                        filled_positions: newFilled,
                        status: newFilled >= (roleData?.positions || 1) ? 'filled' : 'partially_filled'
                    }).eq('id', proposal.role_id);

                    // Check if ALL roles for this job are now filled
                    const { data: allRoles } = await supabase.from('job_roles').select('positions, filled_positions').eq('job_id', proposal.job_id);
                    const isOverallFilled = allRoles?.length > 0 && allRoles.every(r => r.filled_positions >= r.positions);

                    if (isOverallFilled) {
                        await supabase.from('jobs').update({ 
                            status: 'CLOSED',
                            is_bidding_open: false
                        }).eq('id', proposal.job_id);
                    } else {
                        await supabase.from('jobs').update({ status: 'IN_PROGRESS' }).eq('id', proposal.job_id);
                    }
                } else if (jobMeta?.job_mode === 'single') {
                    // SINGLE MODE: Close immediately on first hire
                    await supabase.from('jobs').update({ 
                        status: 'CLOSED',
                        is_bidding_open: false
                    }).eq('id', proposal.job_id);
                } else {
                    // FALLBACK: Mark as in progress
                    await supabase.from('jobs').update({ status: 'IN_PROGRESS' }).eq('id', proposal.job_id);
                }
            } catch (e) {
                logger.error('[Jobs] Role/Job status sync critical failure', e);
            }



            // 4. Reject all other pending proposals for this job
            try {
                await supabase.from('proposals')
                    .update({ status: 'REJECTED' })
                    .eq('job_id', proposal.job_id)
                    .neq('id', id)
                    .eq('status', 'PENDING');
            } catch (e) {
                logger.error('[Proposals] Rejecting others failed', e);
            }

            // 5. Create notification
            try {
                const finalFreelancerId = proposal.freelancer_id || data?.freelancer_id;
                if (finalFreelancerId) {
                    await supabase.from('notifications').insert([{
                        user_id: finalFreelancerId,
                        title: 'Proposal Accepted!',
                        content: `Your proposal for "${jobTitle || 'your job'}" has been accepted. Your role is: ${role}.`,
                        type: 'PROPOSAL',
                        link: '/freelancer/projects'
                    }]);
                    logger.log('[Notifications] Sent acceptance notice', { freelancerId: finalFreelancerId });
                }
            } catch (e) {
                logger.error('[Notifications] Creation failed', e);
            }

            // --- SYNC MATCHING ENGINE ---
            if (proposal.role_id) {
                await matchService.invalidateRoleCache(proposal.role_id);
                matchService.recalculateRoleMatches(proposal.role_id).catch(() => {});
            }
        }

        // Emit real-time event
        try {
            const finalFreelancerId = proposal.freelancer_id || data?.freelancer_id;
            if (finalFreelancerId) {
                getIO().to(`room:user:${finalFreelancerId}`).emit('proposal-status-changed', {
                    proposal_id: id,
                    job_id: proposal.job_id,
                    job_title: jobTitle,
                    status: upperStatus,
                    role: role,
                    contract_id: contract?.id || null,
                });
            }
        } catch (_) {}

        res.status(200).json({
            success: true,
            data: { proposal: data, contract },
            message: upperStatus === 'ACCEPTED' ? 'Proposal accepted and member added to workspace' : `Proposal ${upperStatus.toLowerCase()}`
        });
    } catch (error) {
        logger.error('Error updating proposal status', error);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
};

// Get pending proposals for all jobs of a client
exports.getClientPendingProposals = async (req, res, next) => {
    try {
        const clientId = req.user.id;

        // 1. Fetch all job IDs belonging to the client
        const { data: jobs, error: jobsError } = await supabase
            .from('jobs')
            .select('id')
            .eq('client_id', clientId);

        if (jobsError) throw jobsError;

        const jobIds = (jobs || []).map(j => j.id);

        if (jobIds.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // 2. Fetch proposals for these jobs that are pending
        const { data, error } = await supabase
            .from('proposals')
            .select(`
                id,
                cover_letter,
                proposed_rate,
                created_at,
                status,
                jobs(title, budget_amount, budget_type),
                freelancer:profiles(name, avatar_url)
            `)
            .in('job_id', jobIds)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // 3. Format response
        const formattedData = (data || []).map(p => ({
            id: p.id,
            jobTitle: p.jobs?.title || 'Unknown Job',
            freelancerName: p.freelancer?.name || "Freelancer",
            freelancerImage: p.freelancer?.avatar_url || null,
            bidAmount: p.proposed_rate,
            budgetAmount: p.jobs?.budget_amount || null,
            budgetType: p.jobs?.budget_type || null,
            coverLetter: p.cover_letter,
            createdAt: p.created_at,
            status: p.status
        }));

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        logger.error('Error fetching pending proposals', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server Error', 
            details: error?.message || error,
            hint: error?.hint || 'No hint',
            code: error?.code || 'No code'
        });
    }
};

// Check if current freelancer has already proposed to this job
exports.checkProposal = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const freelancerId = req.user.id;

        const { data, error } = await supabase
            .from('proposals')
            .select('id, status, created_at')
            .eq('job_id', jobId)
            .eq('freelancer_id', freelancerId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "Results contain 0 rows"
            throw error;
        }

        if (data) {
            res.status(200).json({ success: true, hasApplied: true, data });
        } else {
            res.status(200).json({ success: true, hasApplied: false, data: null });
        }
    } catch (error) {
        next(error);
    }
};
/**
 * GET /api/proposals/:id/match
 * High-speed TTL-cached match data for a proposal
 */
exports.getProposalMatch = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 1. Fetch from cache first (Fast UI)
        const { data: cached, error } = await supabase
            .from('matching_cache')
            .select(`
                *,
                proposal:proposals(role_id)
            `)
            .eq('proposal_id', id)
            .maybeSingle();

        if (error) throw error;

        // 2. If no cache or cache is stale (>15 mins), trigger background refresh
        const isStale = !cached || !cached.expires_at || new Date() > new Date(cached.expires_at);
        
        if (isStale) {
            // Locate role_id for background recompute
            let roleId = cached?.proposal?.role_id;
            if (!roleId) {
                const { data: prop } = await supabase.from('proposals').select('role_id').eq('id', id).single();
                roleId = prop?.role_id;
            }

            if (roleId) {
                // Background compute (don't await)
                matchService.recalculateRoleMatches(roleId).catch(e => logger.error('[Match] Background refresh failed', e));
            }
        }

        // 3. Return cached data immediately (<200ms)
        if (!cached) {
            return res.status(200).json({ 
                success: true, 
                data: null, 
                message: 'Match scoring in progress...' 
            });
        }

        res.status(200).json({ success: true, data: cached });

    } catch (error) {
        next(error);
    }
};
