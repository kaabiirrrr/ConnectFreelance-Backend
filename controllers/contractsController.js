const supabase = require('../supabase/client');
const logger = require('../utils/logger');
const { getContractDeadlineRisk } = require('../services/deadlineRiskService');
const { generateProjectPlan } = require('../services/skimmerAIService');
const { recalculateProjectHealth } = require('../services/skimmerEngine');
const adminClient = require('../supabase/adminClient');

exports.createContract = async (req, res, next) => {
    try {
        const { proposal_id, job_id, freelancer_id, agreed_rate, start_date, end_date, role = 'Freelancer' } = req.body;
        const clientId = req.user.id;

        // Use adminClient for cross-table transactional-like operations

        // 1. Create the contract
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .insert([{
                proposal_id,
                job_id,
                client_id: clientId,
                freelancer_id,
                agreed_rate,
                start_date: start_date || new Date(),
                end_date,
                status: 'ACTIVE'
            }])
            .select()
            .single();

        if (contractError) throw contractError;

        // 2. Check if this is the first member to assign 'is_lead'
        const { count: memberCount } = await adminClient
            .from('job_members')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job_id);

        const isLead = memberCount === 0;

        // 3. Normalized role tracking
        const role_normalized = (role || 'freelancer').toLowerCase().trim().replace(/\s+/g, '_');

        // 4. Upsert into job_members (handles Rejoin logic)
        const { error: memberError } = await adminClient
            .from('job_members')
            .upsert({
                job_id,
                user_id: freelancer_id,
                role,
                role_normalized,
                is_lead: isLead,
                added_by: clientId,
                status: 'active',
                joined_at: new Date()
            }, { onConflict: 'job_id, user_id' });

        if (memberError) {
            console.error('[Contract Error] Job Member sync failed', memberError);
            // We don't throw here as the contract is already created, but we log it
        }

        // 5. Log Activity
        await adminClient.from('job_member_activity').insert({
            job_id,
            actor_id: clientId,
            action_type: 'added',
            new_value: role
        });

        // 6. Update job status and bidding state
        const { data: jobData } = await adminClient.from('jobs').select('job_mode, status').eq('id', job_id).single();
        
        if (jobData) {
            const isSingle = jobData.job_mode === 'single' || !jobData.job_mode;
            
            const updates = { 
                status: isSingle ? 'CLOSED' : 'IN_PROGRESS',
                updated_at: new Date()
            };

            // If it's a single job, one hire is enough to close it.
            if (isSingle) {
                updates.is_bidding_open = false;
            }

            await adminClient.from('jobs').update(updates).eq('id', job_id);

            // [SKIMMER] AUTO-GENERATE PROJECT PLAN (70B)
            generateProjectPlan(jobData).then(() => {
                recalculateProjectHealth(job_id);
            }).catch(err => logger.error('[SkimmerTrigger] Plan generation failed', err));
        }

        res.status(201).json({ success: true, data: contract, message: 'Contract created and freelancer added to team' });
    } catch (error) {
        next(error);
    }
};

exports.getUserContracts = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const roleField = role === 'CLIENT' ? 'client_id' : 'freelancer_id';

        const { data, error } = await supabase
            .from('contracts')
            .select(`
                id, proposal_id, job_id, client_id, freelancer_id, 
                agreed_rate, start_date, end_date, status, created_at,
                jobs (title, project_type, budget_type, category),
                proposals (cover_letter),
                freelancer:profiles!contracts_freelancer_id_profiles_fkey (name, avatar_url),
                client:profiles!contracts_client_id_profiles_fkey (name, avatar_url)
            `)
            .eq(roleField, userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Map jobs/client/freelancer array to objects for easier frontend consumption
        const formatted = (data || []).map(c => ({
            ...c,
            job: Array.isArray(c.jobs) ? c.jobs[0] : c.jobs,
            client: Array.isArray(c.client) ? c.client[0] : c.client,
            freelancer: Array.isArray(c.freelancer) ? c.freelancer[0] : c.freelancer
        }));

        res.status(200).json({ success: true, data: formatted, message: 'Contracts retrieved successfully' });
    } catch (error) {
        next(error);
    }
};

exports.getHiredFreelancers = async (req, res) => {
    try {
        const adminClient = require('../supabase/adminClient');
        const clientId = req.user.id;

        const { data: contracts, error: contractsError } = await adminClient
            .from('contracts')
            .select('id, job_id, title, status, agreed_rate, start_date, end_date, created_at, freelancer_id, jobs(title, bid_deadline, budget_amount, budget_type)')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (contractsError) throw contractsError;

        const freelancerIds = [...new Set((contracts || []).map(c => c.freelancer_id).filter(Boolean))];
        let profilesMap = {};

        if (freelancerIds.length > 0) {
            const { data: profiles } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url, email, title')
                .in('user_id', freelancerIds);
            if (profiles) profiles.forEach(p => { profilesMap[p.user_id] = p; });
        }

        const formatted = (contracts || []).map(c => {
            const profile = profilesMap[c.freelancer_id];
            const job = Array.isArray(c.jobs) ? c.jobs[0] : c.jobs;
            return {
                ...c,
                freelancer: {
                    id: c.freelancer_id,
                    name: profile?.name || 'Unknown User',
                    email: profile?.email || null,
                    avatar_url: profile?.avatar_url || null,
                    title: profile?.title || null,
                },
                jobTitle: c.title || job?.title || 'Unknown Job',
                bid_deadline: job?.bid_deadline || null,
                budget_amount: c.agreed_rate || job?.budget_amount || null,
                budget_type: job?.budget_type || 'fixed',
            };
        });

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        logger.error('Hired freelancers error', error);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
};

exports.getContractDeadlineRisk = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await getContractDeadlineRisk(id);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};
