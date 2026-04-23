const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const { getIO } = require('../socket/index');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');

exports.createJob = async (req, res, next) => {
    try {
        const {
            title, description, category, skills, budget_type,
            budget_amount, experience_level, duration, status, attachments,
            bid_deadline, job_mode = 'single', roles
        } = req.body;
        const clientId = req.user.id;

        // ── CONNECT DEDUCTION ──────────────────────────────────────────
        // Only deduct if publishing (not for drafts)
        if (status?.toUpperCase() === 'OPEN') {
            try {
                await connectsService.handleConnectDeduction(clientId, 'job_post', {
                    job_title: title,
                    mode: job_mode
                });
            } catch (err) {
                // Specialized error normalization
                if (err.message === 'INSUFFICIENT_CONNECTS') {
                    return res.status(403).json({ 
                        success: false, 
                        message: "Not enough connects. Please upgrade your plan or buy more connects." 
                    });
                }
                return res.status(403).json({ success: false, message: err.message });
            }
        }

        // 1. Define Job Data Object
        const jobData = {
            client_id: clientId,
            title,
            description,
            category,
            skills: skills || [],
            budget_type: budget_type || 'fixed',
            budget_amount: parseFloat(budget_amount) || 0,
            experience_level: experience_level || 'beginner',
            duration,
            status: (status || 'OPEN').toUpperCase(),
            attachments: attachments || [],
            bid_deadline: bid_deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            is_bidding_open: true,
            job_mode
        };
        
        // 2. Prepare Roles
        let rolesData = [];
        if (job_mode === 'single') {
            rolesData = [{
                title: 'General',
                description: 'Primary role for this project.',
                budget: parseFloat(budget_amount) || 0,
                positions: 1
            }];
        } else if (job_mode === 'team' && roles && roles.length > 0) {
            rolesData = roles.map(r => ({
                title: r.title,
                description: r.description || '',
                budget: parseFloat(r.budget) || 0,
                positions: parseInt(r.positions) || 1,
                priority: parseInt(r.priority) || 0,
                bid_deadline: r.bid_deadline || jobData.bid_deadline
            }));
        }

        // 3. Execute Atomic RPC
        const { data: result, error: rpcError } = await adminClient.rpc('create_job_with_roles', {
            job_data: jobData,
            roles_data: rolesData
        });

        if (rpcError) {
            logger.error('[Jobs] Atomic creation failed', rpcError);
            throw rpcError;
        }

        const job = result.job;
        const finalRoles = result.roles;

        // Emit real-time event
        if ((job.status || '').toUpperCase() === 'OPEN') {
            try { getIO().to('room:freelancers').emit('new-job', { ...job, roles: finalRoles }); } catch (_) {}
        }

        res.status(201).json({ 
            success: true, 
            data: { ...job, roles: finalRoles }, 
            message: status === 'DRAFT' || status === 'draft' ? 'Job saved as draft' : 'Job posted successfully' 
        });

    } catch (error) {
        logger.error('[Jobs] createJob error', error);
        next(error);
    }
};


exports.getClientJobs = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { status } = req.query;

        let query = supabase
            .from('jobs')
            .select(`
                id, title, status, created_at, budget_amount, budget_type, 
                category, experience_level, duration,
                proposals(id, status)
            `)
            .eq('client_id', clientId);

        if (status && status !== 'all') query = query.eq('status', status);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        // Attach proposal counts
        const withCounts = data.map(job => ({
            ...job,
            proposal_count: job.proposals?.length || 0,
            pending_proposals: job.proposals?.filter(p => p.status === 'PENDING').length || 0
        }));

        res.status(200).json({ success: true, data: withCounts });
    } catch (error) {
        next(error);
    }
};

exports.getAllJobs = async (req, res, next) => {
    try {
        const {
            status, skill, category, budget_type, experience_level,
            duration, budget_min, budget_max, proposal_count_range, search
        } = req.query;

        // Pagination
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = (page - 1) * limit;

        let query = supabase
            .from('jobs')
            .select(`
                id, title, description, category, skills, budget_type, 
                budget_amount, experience_level, duration, status, 
                created_at, client_id, proposal_count
            `, { count: 'exact' });

        // Keyword Search
        if (search) {
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        }

        // Basic Filters
        if (status) query = query.eq('status', status.toUpperCase());
        if (skill) {
            const skills = Array.isArray(skill) ? skill : [skill];
            query = query.contains('skills', skills);
        }
        if (category) {
            const categories = Array.isArray(category) ? category : [category];
            query = query.in('category', categories);
        }
        if (budget_type) query = query.eq('budget_type', budget_type.toLowerCase());

        // Advanced Filters
        if (experience_level) {
            const levels = Array.isArray(experience_level) ? experience_level : [experience_level];
            query = query.in('experience_level', levels.map(l => l.toLowerCase()));
        }

        if (duration) {
            const durations = Array.isArray(duration) ? duration : [duration];
            query = query.in('duration', durations);
        }

        if (budget_min) query = query.gte('budget_amount', parseFloat(budget_min));
        if (budget_max) query = query.lte('budget_amount', parseFloat(budget_max));

        // Proposal Count Range Filtering
        if (proposal_count_range) {
            const ranges = Array.isArray(proposal_count_range) ? proposal_count_range : [proposal_count_range];
            ranges.forEach(range => {
                if (range === '0-5') query = query.lte('proposal_count', 5);
                else if (range === '5-10') query = query.gt('proposal_count', 5).lte('proposal_count', 10);
                else if (range === '10-15') query = query.gt('proposal_count', 10).lte('proposal_count', 15);
                else if (range === '15-20') query = query.gt('proposal_count', 15).lte('proposal_count', 20);
                else if (range === '20-50') query = query.gt('proposal_count', 20).lte('proposal_count', 50);
            });
        }

        const { data: jobs, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error('[Jobs] getAllJobs DB error', error);
            throw error;
        }

        if (!jobs || jobs.length === 0) {
            return res.status(200).json({ success: true, data: [], pagination: { page, limit, total: count || 0, totalPages: 0 } });
        }

        // Fetch client profiles to enrich job data
        const clientIds = [...new Set(jobs.map(j => j.client_id).filter(Boolean))];
        let profileMap = {};

        if (clientIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('user_id, name, company_name, avatar_url')
                .in('user_id', clientIds);


            if (profiles) {
                profiles.forEach(p => { profileMap[p.user_id] = p; });
            }
        }

        const enriched = jobs.map(job => ({
            ...job,
            client: profileMap[job.client_id] || null
        }));

        const totalPages = Math.ceil((count || 0) / limit);

        res.status(200).json({
            success: true,
            data: enriched,
            pagination: { page, limit, total: count || 0, totalPages }
        });
    } catch (error) {
        logger.error('[Jobs] getAllJobs unhandled error', error);
        next(error);
    }
};

exports.getJobFilterStats = async (req, res, next) => {
    try {
        const { data: stats, error } = await supabase.rpc('get_job_filter_stats_v2');

        if (error) {
            // FALLBACK logic if RPC fails (e.g. during migration)
            const { data: jobs, error: fallbackError } = await supabase
                .from('jobs')
                .select('experience_level, budget_type, duration, proposal_count')
                .eq('is_bidding_open', true)
                .neq('status', 'DRAFT');

            if (fallbackError) throw fallbackError;

            const calcStats = {
                experience: { entry: 0, intermediate: 0, expert: 0 },
                budget_type: { fixed: 0, hourly: 0 },
                proposals: { '0-5': 0, '5-10': 0, '10-15': 0, '15-20': 0, '20-50': 0 },
                duration: { 'less_than_1_month': 0, '1-3_months': 0, '3-6_months': 0, 'more_than_6_months': 0 }
            };

            jobs.forEach(job => {
                if (job.experience_level) calcStats.experience[job.experience_level.toLowerCase()]++;
                if (job.budget_type) calcStats.budget_type[job.budget_type.toLowerCase()]++;
                // ... (simplified fallback)
            });
            return res.status(200).json({ success: true, data: calcStats });
        }

        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }

};

exports.getJobById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('jobs')
            .select(`
                id, title, description, category, skills, budget_type, 
                budget_amount, experience_level, duration, status, job_mode,
                created_at, client_id, attachments, bid_deadline, is_bidding_open,
                client:profiles(name, company_name, avatar_url, country), 
                proposals(id, freelancer_id, proposed_rate, status, role_id),
                roles:job_roles(*)
            `)
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'Job not found' });


        // Calculate proposal count before any privacy filtering
        const proposalCount = data.proposals?.length || 0;

        // ─── Proposal Privacy Filtering (CRITICAL) ─────────────
        const isOwner = req.user && req.user.id === data.client_id;
        const isAdmin = req.user && ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);

        if (!isOwner && !isAdmin) {
            if (req.user && req.user.role === 'FREELANCER') {
                // Return ONLY the current user's proposal if it exists
                data.proposals = (data.proposals || []).filter(p => p.freelancer_id === req.user.id);
            } else {
                // Anonymous or other Client: Remove sensitive proposal details entirely
                delete data.proposals;
            }
        }

        // Fetch Client Stats (Real Data)
        const clientId = data.client_id;
        
        const [postRes, hireRes] = await Promise.all([
            adminClient.from('jobs').select('*', { count: 'exact', head: true }).eq('client_id', clientId),
            adminClient.from('contracts').select('*', { count: 'exact', head: true }).eq('client_id', clientId)
        ]);


        const totalPosted = postRes.count || 0;
        const totalHires = hireRes.count || 0;
        const hireRate = totalPosted > 0 ? Math.min(Math.round((totalHires / totalPosted) * 100), 100) : 0;
        
        const enrichedData = {
            ...data,
            proposal_count: proposalCount,
            client_stats: {
                total_posted: totalPosted,
                total_hires: totalHires,
                hire_rate: hireRate
            }
        };

        res.status(200).json({ success: true, data: enrichedData });
    } catch (error) {
        next(error);
    }
};


exports.updateJob = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const clientId = req.user.id;

        const { data: existingJob, error: fetchError } = await supabase.from('jobs').select('client_id, status, title').eq('id', id).single();

        if (fetchError || !existingJob) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (existingJob.client_id !== clientId) {
            return res.status(403).json({ success: false, message: 'You are not authorized to edit this job' });
        }

        // ── TRANSITION-BASED CONNECT DEDUCTION ────────────────────────
        const newStatus = updates.status?.toUpperCase();
        const oldStatus = existingJob.status?.toUpperCase();

        if (oldStatus !== 'OPEN' && newStatus === 'OPEN') {
            try {
                await connectsService.handleConnectDeduction(clientId, 'job_post', {
                    job_id: id,
                    job_title: existingJob.title,
                    transition: `${oldStatus} -> ${newStatus}`
                });
            } catch (err) {
                if (err.message === 'INSUFFICIENT_CONNECTS') {
                    return res.status(403).json({ 
                        success: false, 
                        message: "Not enough connects to publish this job. Please upgrade your plan." 
                    });
                }
                return res.status(403).json({ success: false, message: err.message });
            }
        }

        if (updates.budget_amount !== undefined) {
            const amount = parseFloat(updates.budget_amount);
            updates.budget_amount = amount;
            updates.budget = amount;
        }

        if (updates.status) {
            updates.status = updates.status.toUpperCase();
        }

        if (updates.skills && !Array.isArray(updates.skills)) {
            updates.skills = [updates.skills];
        }

        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from('jobs').update(updates).eq('id', id).select().single();
        if (error) throw error;

        // Emit targeted events
        try {
            const io = getIO();
            // Notify the client who owns this job
            io.to(`room:user:${clientId}`).emit('job-updated', data);
            // If status changed to OPEN, notify freelancers too
            if ((data.status || '').toUpperCase() === 'OPEN') {
                io.to('room:freelancers').emit('new-job', data);
            } else if (['CLOSED', 'COMPLETED', 'IN_PROGRESS'].includes((data.status || '').toUpperCase())) {
                io.to('room:freelancers').emit('job-updated', data);
            }
        } catch (_) {}

        res.status(200).json({ success: true, data, message: 'Job updated successfully' });
    } catch (error) {
        logger.error('[Jobs] updateJob error', error);
        next(error);
    }
};

exports.deleteJob = async (req, res, next) => {
    try {
        const { id } = req.params;
        const clientId = req.user.id;

        const { data: job } = await supabase.from('jobs').select('client_id').eq('id', id).single();
        if (!job || job.client_id !== clientId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { error } = await supabase.from('jobs').delete().eq('id', id);
        if (error) throw error;

        // Notify all freelancers to remove this job from their lists
        try { getIO().to('room:freelancers').emit('job-deleted', { id }); } catch (_) {}
        // Notify the client too
        try { getIO().to(`room:user:${clientId}`).emit('job-deleted', { id }); } catch (_) {}

        res.status(200).json({ success: true, message: 'Job deleted' });
    } catch (error) {
        next(error);
    }
};

exports.getDashboardSummary = async (req, res, next) => {
    try {
        const adminClient = require('../supabase/adminClient');
        const clientId = req.user.id;
        const { calculateReliabilityScore } = require('../utils/reliabilityCalculator');
        const { predictRisk } = require('../utils/riskPredictor');
        const { predictDeadlineFailure } = require('../utils/deadlinePredictor');

        const [jobsRes, contractsRes, proposalsRes] = await Promise.all([
            adminClient.from('jobs').select('id, title, status, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
            adminClient.from('contracts').select('id, title, job_id, status, is_direct, freelancer_id, created_at, job:jobs(title)').eq('client_id', clientId).eq('status', 'ACTIVE'),
            adminClient.from('proposals').select('id, status, job_id, created_at').in('job_id',
                (await adminClient.from('jobs').select('id').eq('client_id', clientId)).data?.map(j => j.id) || []
            ).eq('status', 'PENDING')
        ]);

        const activeContracts = contractsRes.data || [];
        
        // Enrich contracts with deterministic deadline risk
        const enrichedContracts = await Promise.all(activeContracts.map(async (contract) => {
            try {
                // Fetch freelancer profile for reliability score
                const { data: profile } = await adminClient.from('profiles').select('reliability_score').eq('user_id', contract.freelancer_id).single();
                const { stats } = await calculateReliabilityScore(contract.freelancer_id);
                const riskResult = predictRisk(profile?.reliability_score || 100, stats);
                
                const consistency = stats.expected > 0 ? Math.round((stats.logs / stats.expected) * 100) : 100;
                let daysRemaining = null;
                if (contract.end_date) {
                    daysRemaining = (new Date(contract.end_date) - new Date()) / (1000 * 60 * 60 * 24);
                }

                const deadlineRisk = predictDeadlineFailure(
                    riskResult.riskScore,
                    profile?.reliability_score || 100,
                    stats.missed,
                    consistency,
                    daysRemaining
                );

                return { ...contract, deadline_risk: { probability: deadlineRisk.probability, risk: deadlineRisk.riskLevel } };
            } catch (err) {
                return contract;
            }
        }));

        res.status(200).json({
            success: true,
            data: {
                jobs: jobsRes.data || [],
                active_contracts: enrichedContracts,
                pending_proposals: proposalsRes.data || [],
                stats: {
                    total_jobs: jobsRes.data?.length || 0,
                    open_jobs: jobsRes.data?.filter(j => j.status === 'OPEN').length || 0,
                    active_contracts: contractsRes.data?.length || 0,
                    pending_proposals: proposalsRes.data?.length || 0
                }
            }
        });
    } catch (err) {
        next(err);
    }
};

exports.findWork = async (req, res, next) => {
    try {
        const adminClient = require('../supabase/adminClient');
        const userId = req.user?.id;
        const { tab = 'best_matches', search, skill, category, budget_type, min_budget, max_budget, experience_level, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        if (tab === 'saved' && userId) {
            const { data: saved } = await adminClient.from('saved_jobs').select('job_id').eq('freelancer_id', userId);
            const savedIds = (saved || []).map(s => s.job_id);
            if (!savedIds.length) return res.status(200).json({ success: true, data: [], pagination: { total: 0 } });
            const { data, error, count } = await adminClient.from('jobs').select(`
                id, title, description, category, skills, budget_type, 
                budget_amount, experience_level, duration, status, 
                created_at, client_id, proposal_count
            `, { count: 'exact' })
            .in('id', savedIds)
            .eq('is_bidding_open', true)
            .neq('status', 'DRAFT')
            .order('created_at', { ascending: false }).range(offset, offset + Number(limit) - 1);
            if (error) throw error;
            return res.status(200).json({ success: true, data: (data || []).map(j => ({ ...j, is_saved: true })), pagination: { total: count || 0, page: Number(page), limit: Number(limit), pages: Math.ceil((count || 0) / Number(limit)) } });
        }

        let query = adminClient.from('jobs').select(`
            id, title, description, category, skills, budget_type, 
            budget_amount, experience_level, duration, status, 
            created_at, client_id, proposal_count
        `, { count: 'exact' })
        .eq('is_bidding_open', true)
        .in('status', ['OPEN', 'IN_PROGRESS']);


        if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        
        // --- MARK ALREADY APPLIED JOBS (don't hide them) ---
        let appliedIds = [];
        if (userId && tab !== 'saved') {
            const { data: myApps } = await adminClient
                .from('proposals')
                .select('job_id')
                .eq('freelancer_id', userId);
            
            appliedIds = (myApps || []).map(a => a.job_id);
        }

        if (skill) query = query.contains('skills', [skill]);
        if (category) query = query.eq('category', category);
        if (budget_type) query = query.eq('budget_type', budget_type);
        if (min_budget) query = query.gte('budget_amount', Number(min_budget));
        if (max_budget) query = query.lte('budget_amount', Number(max_budget));
        if (experience_level) query = query.eq('experience_level', experience_level);
        query = query.order('created_at', { ascending: false });

        const { data: jobs, error, count } = await query.range(offset, offset + Number(limit) - 1);
        if (error) throw error;

        const clientIds = [...new Set((jobs || []).map(j => j.client_id).filter(Boolean))];
        let profileMap = {};
        if (clientIds.length) {
            const { data: profiles } = await adminClient.from('profiles').select('user_id, name, avatar_url, company_name').in('user_id', clientIds);
            profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        }

        let savedSet = new Set();
        if (userId) {
            const { data: saved } = await adminClient.from('saved_jobs').select('job_id').eq('freelancer_id', userId);
            savedSet = new Set((saved || []).map(s => s.job_id));
        }

        const appliedSet = new Set(appliedIds);
        const enriched = (jobs || []).map(job => ({ ...job, client: profileMap[job.client_id] || null, is_saved: savedSet.has(job.id), already_applied: appliedSet.has(job.id) }));
        res.status(200).json({ success: true, data: enriched, pagination: { total: count || 0, page: Number(page), limit: Number(limit), pages: Math.ceil((count || 0) / Number(limit)) } });
    } catch (err) {
        next(err);
    }
};

exports.toggleSaveJob = async (req, res, next) => {
    try {
        const adminClient = require('../supabase/adminClient');
        const freelancerId = req.user.id;
        const { id: jobId } = req.params;
        const { data: existing } = await adminClient.from('saved_jobs').select('id').eq('freelancer_id', freelancerId).eq('job_id', jobId).maybeSingle();
        if (existing) {
            await adminClient.from('saved_jobs').delete().eq('id', existing.id);
            return res.status(200).json({ success: true, saved: false, message: 'Job unsaved' });
        }
        await adminClient.from('saved_jobs').insert([{ freelancer_id: freelancerId, job_id: jobId }]);
        res.status(201).json({ success: true, saved: true, message: 'Job saved' });
    } catch (err) {
        next(err);
    }
};

exports.searchJobs = async (req, res, next) => {
    try {
        const q = req.query.q || '';
        const { data, error } = await supabase
            .from('jobs')
            .select(`
                id, title, description, category, skills, budget_type, 
                budget_amount, experience_level, duration, status, 
                created_at, client_id, proposal_count
            `)
            .eq('is_bidding_open', true)
            .in('status', ['OPEN', 'IN_PROGRESS'])


            .or(`title.ilike.%${q}%,description.ilike.%${q}%,skills::text.ilike.%${q}%,category.ilike.%${q}%`)
            .order('created_at', { ascending: false })
            .limit(20);
            
        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

exports.getRecentJobs = async (req, res, next) => {
    req.query.tab = 'recent';
    return exports.findWork(req, res, next);
};

exports.getBestMatches = async (req, res, next) => {
    req.query.tab = 'best_matches';
    if (req.params.freelancerId && !req.user) {
        req.user = { id: req.params.freelancerId };
    }
    return exports.findWork(req, res, next);
};

/**
 * PATCH /api/jobs/:id/bidding/close
 * Close bidding for a job (Client action)
 */
exports.closeJobBidding = async (req, res, next) => {
    try {
        const { id } = req.params;
        const clientId = req.user.id;

        // 1. Verify ownership
        const { data: job, error: fetchError } = await supabase
            .from('jobs')
            .select('client_id')
            .eq('id', id)
            .single();

        if (fetchError || !job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (job.client_id !== clientId) {
            return res.status(403).json({ success: false, message: 'Unauthorized to close this job' });
        }

        // 2. Update status and lock bidding
        const { data, error } = await supabase
            .from('jobs')
            .update({ 
                is_bidding_open: false,
                status: 'CLOSED'
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            success: true,
            message: 'Bidding closed successfully',
            data
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET WORKSPACE DATA (TEAM + ANALYTICS)
 */

exports.getWorkspaceData = async (req, res, next) => {
    try {
        const { id: jobId } = req.params;
        const userId = req.user.id;

        // 1. Fetch team members (Resilient approach)
        let membersRaw = [];
        try {
            const { data, error } = await adminClient
                .from('job_members')
                .select('*')
                .eq('job_id', jobId)
                .eq('status', 'active')
                .order('member_order', { ascending: true });
            
            if (!error && data && data.length > 0) {
                membersRaw = data;
            } else {
                // FALLBACK: If job_members is empty/missing, derive from contracts
                const { data: contractMembers, error: cErr } = await adminClient
                    .from('contracts')
                    .select('id, freelancer_id, status, created_at')
                    .eq('job_id', jobId)
                    .eq('status', 'ACTIVE');
                
                if (!cErr && contractMembers) {
                    membersRaw = contractMembers.map(c => ({
                        id: c.id, 
                        user_id: c.freelancer_id,
                        role: 'Task Specialist', // Safer generic fallback
                        role_normalized: 'task_specialist',
                        scope: 'Mission parameters inherited from contract.',
                        is_lead: false,
                        status: 'active',
                        joined_at: c.created_at,
                        is_fallback: true
                    }));
                }
            }
        } catch (e) {
            logger.error('[Workspace] Members fetch crash', e);
        }

        // 1b. Manually zip profiles to avoid join crashes
        const userIds = (membersRaw || []).map(m => m.user_id);
        let profiles = [];
        if (userIds.length > 0) {
            try {
                const { data: profileData } = await adminClient
                    .from('profiles')
                    .select('user_id, name, avatar_url')
                    .in('user_id', userIds);
                profiles = profileData || [];
            } catch (e) {}
        }

        const members = (membersRaw || []).map(m => ({
            ...m,
            profile: profiles.find(p => p.user_id === m.user_id) || null
        }));

        // 2. Authorization Check: Must be client or member
        let isClientData = false;
        try {
            const { data: clientCheck } = await adminClient.from('jobs').select('client_id').eq('id', jobId).eq('client_id', userId).maybeSingle();
            isClientData = !!clientCheck;
        } catch (e) {}
        
        const isMember = (members || []).some(m => m.user_id === userId);

        if (!isClientData && !isMember) {
            return res.status(403).json({ success: false, message: 'Access denied to this workspace' });
        }

        // 3. Fetch Deliveries for Analytics (Graceful failure)
        let analytics = [];
        try {
            const { data: deliveries, error: delError } = await adminClient
                .from('deliveries')
                .select('id, status, freelancer_id')
                .eq('job_id', jobId);

            if (!delError && members) {
                analytics = members.map(member => {
                    const memberDeliveries = deliveries?.filter(d => d.freelancer_id === member.user_id) || [];
                    const approved = memberDeliveries.filter(d => d.status === 'approved').length;
                    const total = memberDeliveries.length;
                    
                    return {
                        user_id: member.user_id,
                        role: member.role,
                        role_normalized: member.role_normalized,
                        total_deliveries: total,
                        approved_deliveries: approved,
                        progress: total > 0 ? Math.round((approved / total) * 100) : 0,
                        is_acknowledged: member.scope_acknowledged
                    };
                });
            }
        } catch (e) {
            logger.error('[Workspace] Analytics calculation failed', e);
        }

        // --- SCOPE ISOLATION (Enterprise Privacy) ---
        const sanitizedMembers = (members || []).map(m => {
            const isSelf = m.user_id === userId;
            if (!isClientData && !isSelf) {
                const sanitized = { ...m };
                delete sanitized.scope;
                delete sanitized.scope_version;
                delete sanitized.scope_updated_at;
                return sanitized;
            }
            return m;
        });

        // 5. Fetch Activity Logs (Non-blocking)
        let activity = [];
        try {
            const { data: activityData, error: actError } = await adminClient
                .from('job_member_activity')
                .select('*, actor:profiles!actor_id(name)')
                .eq('job_id', jobId)
                .order('created_at', { ascending: false })
                .limit(20);
            
            if (!actError) activity = activityData;
        } catch (e) {
            logger.error('[Workspace] Activity logs fetch failed', e);
        }

        res.status(200).json({
            success: true,
            data: {
                members: sanitizedMembers,
                analytics: analytics || [],
                activity: activity || []
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * ACKNOWLEDGE MISSION SCOPE (FREELANCER)
 */
exports.acknowledgeMission = async (req, res, next) => {
    try {
        const { id: jobId } = req.params;
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('job_members')
            .update({ 
                scope_acknowledged: true, 
                acknowledged_at: new Date() 
            })
            .eq('job_id', jobId)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        // Log Activity
        await adminClient.from('job_member_activity').insert({
            job_id: jobId,
            member_id: data.id,
            actor_id: userId,
            action_type: 'status_changed',
            new_value: 'Mission Acknowledged'
        });

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

/**
 * CLOSE JOB BIDDING (CLIENT)
 */
exports.closeJobBidding = async (req, res, next) => {
    try {
        const { id } = req.params;
        const clientId = req.user.id;

        const { data: job, error: jobErr } = await adminClient
            .from('jobs')
            .update({ is_bidding_open: false, status: 'IN_PROGRESS' })
            .eq('id', id)
            .eq('client_id', clientId)
            .select()
            .single();

        if (jobErr) throw jobErr;

        res.status(200).json({ success: true, data: job, message: 'Bidding closed. Job is now private and focused on the active team.' });
    } catch (err) {
        next(err);
    }
};

/**
 * UPDATE JOB MEMBER (ROLE & SCOPE MANAGEMENT)
 */
exports.updateJobMember = async (req, res, next) => {
    try {
        const { id: jobId, memberId } = req.params;
        const { role, scope, is_lead, member_order } = req.body;
        const actorId = req.user.id;

        // Verify Client Ownership
        const { data: job } = await adminClient.from('jobs').select('client_id').eq('id', jobId).single();
        if (!job || job.client_id !== actorId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Fetch current member state for versioning
        let { data: currentMember } = await adminClient.from('job_members').select('*').eq('id', memberId).maybeSingle();

        // FALLBACK SYNC: If member not found in job_members, check if it's a contract ID from fallback
        if (!currentMember) {
            const { data: contract } = await adminClient
                .from('contracts')
                .select('*')
                .eq('id', memberId)
                .single();
            
            if (contract) {
                // Create the member record on the fly
                const { data: newMember, error: createError } = await adminClient
                    .from('job_members')
                    .insert({
                        job_id: jobId,
                        user_id: contract.freelancer_id,
                        role: role || 'Lead Freelancer',
                        role_normalized: (role || 'Lead Freelancer').toLowerCase().replace(/\s+/g, '_'),
                        scope: scope || 'Mission defined during workspace sync.',
                        added_by: actorId,
                        joined_at: contract.created_at
                    })
                    .select()
                    .single();
                
                if (createError) throw createError;
                currentMember = newMember;
            } else {
                return res.status(404).json({ success: false, message: 'Member or Contract not found' });
            }
        }

        const updates = {};
        if (role) {
            updates.role = role;
            updates.role_normalized = role.toLowerCase().trim().replace(/\s+/g, '_');
        }
        
        if (scope && scope !== currentMember.scope) {
            updates.scope = scope;
            updates.scope_version = (currentMember.scope_version || 1) + 1;
            updates.scope_updated_at = new Date();
            updates.scope_acknowledged = false; // Reset acknowledgment on major scope change
        }

        if (is_lead !== undefined) updates.is_lead = is_lead;
        if (member_order !== undefined) updates.member_order = member_order;

        const { data: member, error } = await adminClient
            .from('job_members')
            .update(updates)
            .eq('id', memberId)
            .select()
            .single();

        if (error) throw error;

        // Log Scope History if changed
        if (scope && scope !== currentMember.scope) {
            await adminClient.from('job_member_scope_history').insert({
                job_id: jobId,
                member_id: memberId,
                scope: scope,
                actor_id: actorId,
                version: updates.scope_version
            });
        }

        // Log Activity
        await adminClient.from('job_member_activity').insert({
            job_id: jobId,
            member_id: memberId,
            actor_id: actorId,
            action_type: scope ? 'scope_changed' : 'role_changed',
            new_value: scope || role
        });

        res.status(200).json({ success: true, data: member });
    } catch (err) {
        next(err);
    }
};

/**
 * REMOVE JOB MEMBER (SOFT DELETE)
 */
exports.removeJobMember = async (req, res, next) => {
    try {
        const { id: jobId, memberId } = req.params;
        const actorId = req.user.id;

        // Verify Client Ownership
        const { data: job } = await adminClient.from('jobs').select('client_id').eq('id', jobId).single();
        if (!job || job.client_id !== actorId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const { error } = await adminClient
            .from('job_members')
            .update({ 
                status: 'removed', 
                removed_at: new Date() 
            })
            .eq('id', memberId);

        if (error) throw error;

        // Log Activity
        await adminClient.from('job_member_activity').insert({
            job_id: jobId,
            member_id: memberId,
            actor_id: actorId,
            action_type: 'removed'
        });

        res.status(200).json({ success: true, message: 'Member removed from workspace' });
    } catch (err) {
        next(err);
    }
};
