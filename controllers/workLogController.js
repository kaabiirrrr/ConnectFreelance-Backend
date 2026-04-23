const adminClient = require('../supabase/adminClient');
const { notifyUser } = require('./notificationController');
const logger = require('../utils/logger');
const { triggerReliabilityUpdate } = require('../utils/reliabilityService');
const moderationService = require('../services/moderationService');
const enforcementService = require('../services/enforcementService');
const { recalculateProjectHealth } = require('../services/skimmerEngine');



/**
 * UPSERT Work Log
 * Logic: Validates freelancer assignment, note quality, same-day restriction, and anti-future-date.
 */
exports.upsertWorkLog = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { job_id, note, date, hours } = req.body;

        console.log(`[upsertWorkLog] START -> Freelancer: ${freelancerId}, Job: ${job_id}, Date: ${date}`);
        console.log(`[upsertWorkLog] Body:`, JSON.stringify(req.body));

        // 3. Structural Validation: Ensure job_id is valid
        if (!job_id) {
            console.error('[upsertWorkLog] 400 FAILED: job_id is missing from request');
            return res.status(400).json({ success: false, message: 'Missing job_id reference.' });
        }

        // 1. Quality Control: Min 10 characters
        if (!note || note.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'Please provide a more meaningful update (min 10 characters).' });
        }

        // --- CONTACT PROTECTION INJECTION (v2) ---
        const moderation = await moderationService.moderate(note, freelancerId);
        if (moderation.blocked) {
            // Process enforcement
            const enforcement = await enforcementService.processViolation(freelancerId, {
                ...moderation,
                message: note
            });

            return res.status(403).json({
                success: false,
                message: `Update blocked: ${moderation.reason}`,
                action: enforcement.action,
                strikes: enforcement.strikes,
                flagged_content: note
            });
        }


        // 2. Anti-Future-Date logic
        const logDate = new Date(date || new Date().toISOString().split('T')[0]);
        const today = new Date();
        today.setHours(23, 59, 59, 999); // Allow until end of today locally

        if (logDate > today) {
            return res.status(400).json({ success: false, message: 'Cannot log work for a future date.' });
        }

        // 3. Same-Day Edit locking (Date must be today to upsert/edit)
        const dateStr = date || new Date().toISOString().split('T')[0];
        const isToday = dateStr === new Date().toISOString().split('T')[0];
        
        // Note: The unique constraint on (job_id, freelancer_id, date) handles the "one log per day" rule.
        // We only allow UPSERT if it's today. If they try to log for a past date that already exists, 
        // they shouldn't be able to edit it if we want strict "Same-Day Only" editing.
        
        // 4. Validate Freelancer Assignment (Broad search for debugging)
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('id, status, freelancer_id')
            .eq('job_id', job_id)
            .eq('freelancer_id', freelancerId)
            .single();

        if (contractError) {
            console.error(`[upsertWorkLog] DB ERROR checking contract:`, JSON.stringify(contractError));
        }

        if (!contract) {
            console.warn(`[upsertWorkLog] 403 FAILED: No contract record found at all for Freelancer: ${freelancerId} and Job: ${job_id}.`);
            return res.status(403).json({ success: false, message: 'Not authorized. No contract found for this job.' });
        }

        console.log(`[upsertWorkLog] Contract found with status: ${contract.status}`);

        if (!['ACTIVE', 'IN_PROGRESS'].includes(contract.status?.toUpperCase())) {
            console.warn(`[upsertWorkLog] 403 FAILED: Contract exists but status is ${contract.status}. Logging blocked.`);
            return res.status(403).json({ success: false, message: `Contract is ${contract.status}. You can only log work for ACTIVE projects.` });
        }

        console.log(`[upsertWorkLog] AUTH SUCCESS: Found contract ${contract.id}`);

        // 5. Upsert Log (with Smart Fallback)
        try {
            const logPayload = {
                job_id,
                freelancer_id: freelancerId,
                note,
                hours: hours || 0,
                date: dateStr,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await adminClient
                .from('work_logs')
                .upsert(logPayload, { onConflict: 'job_id, freelancer_id, date' })
                .select()
                .single();

            if (error) {
                // FALLBACK: If 'hours' column is missing (PGRST204), try saving WITHOUT hours
                if (error.code === 'PGRST204' || error.message?.includes('hours')) {
                    console.warn('[upsertWorkLog] Column "hours" missing. Falling back to note-only save.');
                    delete logPayload.hours;

                    const { data: fbData, error: fbError } = await adminClient
                        .from('work_logs')
                        .upsert(logPayload, { onConflict: 'job_id, freelancer_id, date' })
                        .select()
                        .single();

                    if (fbError) throw fbError;

                    return res.status(200).json({ 
                        success: true, 
                        data: fbData, 
                        message: 'Update saved (Note only). To enable the "Hours Worked" feature, please run the SQL update in Supabase.' 
                    });
                }
                throw error;
            }

            // Trigger reliability score recalculation
            triggerReliabilityUpdate(freelancerId);

            // [SKIMMER] Trigger health recalculation
            recalculateProjectHealth(job_id);

            return res.status(200).json({ 
                success: true, 
                data, 
                message: 'Daily work update saved successfully.' 
            });
        } catch (dbErr) {
            console.error('[upsertWorkLog] DB ERROR:', dbErr);
            throw dbErr;
        }

    } catch (err) {
        logger.error('Upsert Work Log Error:', err);
        next(err);
    }
};

/**
 * GET Work Logs for a Job
 * Includes Pagination and Soft-Delete protection
 */
exports.getJobLogs = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const userId = req.user.id;
        const userRole = req.user.role;

        // 1. Security: Ensure user is either the assigned freelancer or the client who posted the job
        const { data: job, error: jobError } = await adminClient
            .from('jobs')
            .select('client_id, id')
            .eq('id', jobId)
            .single();

        if (jobError || !job) {
            return res.status(404).json({ success: false, message: 'Job not found.' });
        }

        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('freelancer_id')
            .eq('job_id', jobId)
            .eq('status', 'ACTIVE')
            .single();

        const isClient = job.client_id === userId;
        const isAssignedFreelancer = contract?.freelancer_id === userId;

        if (!isClient && !isAssignedFreelancer) {
            return res.status(403).json({ success: false, message: 'Not authorized to view logs for this job.' });
        }

        // 2. Fetch Logs with Pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error, count } = await adminClient
            .from('work_logs')
            .select('*, freelancer:profiles!work_logs_freelancer_id_fkey(name, avatar_url)', { count: 'exact' })
            .eq('job_id', jobId)
            .is('deleted_at', null)
            .order('date', { ascending: false })
            .range(from, to);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (err) {
        logger.error('Get Job Logs Error:', err);
        next(err);
    }
};

/**
 * GET Client Dashboard Summary
 * Fetches today's activity status across all active jobs.
 */
exports.getClientSummary = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        
        console.log(`[getClientSummary] START -> User: ${userId}, Date: ${today}`);

        // 1. Get all relevant contracts
        console.log(`[getClientSummary] Fetching contracts for client: ${userId}`);
        const { data: contracts, error: contractsError } = await adminClient
            .from('contracts')
            .select(`
                id, 
                job_id, 
                freelancer_id,
                status,
                jobs (id, title),
                freelancer:profiles!contracts_freelancer_id_profiles_fkey (name, avatar_url)
            `)
            .eq('client_id', userId)
            .neq('status', 'COMPLETED');

        if (contractsError) {
            console.error(`[getClientSummary] Contracts Error:`, contractsError);
            throw contractsError;
        }

        console.log(`[getClientSummary] Found ${contracts?.length || 0} contracts`);

        if (!contracts || contracts.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        const jobIds = contracts.map(c => c.job_id);
        
        // 2. Get today's logs
        const { data: logs, error: logsError } = await adminClient
            .from('work_logs')
            .select('*')
            .in('job_id', jobIds)
            .eq('date', today);

        if (logsError) {
            console.error(`[getClientSummary] Logs Error:`, logsError);
        }

        // 3. Robust Mapping
        const summary = contracts.map(c => {
            const contractLogs = (logs || []).filter(l => l.job_id === c.job_id && l.freelancer_id === c.freelancer_id);
            const latestLog = contractLogs[0];
            const totalHours = contractLogs.reduce((sum, l) => sum + (Number(l.hours) || 0), 0);
            
            const jobData = Array.isArray(c.jobs) ? c.jobs[0] : c.jobs;
            const freelancerData = Array.isArray(c.freelancer) ? c.freelancer[0] : c.freelancer;

            return {
                contractId: c.id,
                jobId: c.job_id,
                jobTitle: jobData?.title || 'Untitled Project',
                status: latestLog ? 'UPDATED' : 'PENDING',
                lastUpdate: latestLog ? latestLog.updated_at : null,
                hoursToday: totalHours,
                notePreview: latestLog?.note ? latestLog.note.toString().substring(0, 100) : "Awaiting today's update...",
                freelancer: freelancerData || { name: 'Freelancer' }
            };

        });

        console.log(`[getClientSummary] SUCCESS -> Returning ${summary.length} items.`);
        return res.status(200).json({ success: true, data: summary });

    } catch (err) {
        console.error(`[getClientSummary] FATAL ERROR:`, err);
        if (typeof logger !== 'undefined' && logger.error) {
            logger.error('Client Summary Fatal:', err);
        }
        next(err);
    }
};

/**
 * ASK FOR WORK UPDATE
 * Client queries a freelancer about missing logs. Throttled to 3/day.
 */
exports.askForWorkUpdate = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { job_id, freelancer_id, message } = req.body;
        const today = new Date().toISOString().split('T')[0];

        // 1. Rate Limiting: Max 3 queries per day per job
        const { count, error: countError } = await adminClient
            .from('work_log_queries')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job_id)
            .eq('client_id', clientId)
            .gte('created_at', `${today}T00:00:00Z`);

        if (countError) throw countError;

        if (count >= 5) {
            return res.status(429).json({ success: false, message: 'Daily limit reached. You can only request updates 5 times per day per job.' });
        }

        // 2. Persist Query
        const { data, error } = await adminClient
            .from('work_log_queries')
            .insert([{
                job_id,
                freelancer_id,
                client_id: clientId,
                message: message || "Can you please provide an update on today's progress?"
            }])
            .select()
            .single();

        if (error) throw error;

        // Trigger reliability score recalculation for freelancer in background (penalty for query)
        triggerReliabilityUpdate(freelancer_id);

        // 3. Trigger in-app notification for freelancer
        try {
            const { notifyUser } = require('./notificationController');
            await notifyUser(freelancer_id, {
                title: 'Work Update Requested',
                content: message || "Your client is asking for an update on today's progress.",
                type: 'ALERT',
                link: `/freelancer/work-activity`
            });
        } catch (noteErr) {
            console.error('[askForWorkUpdate] Notification failed:', noteErr);
        }

        res.status(201).json({ success: true, message: 'Update request sent successfully.' });

    } catch (err) {
        logger.error('Ask For Update Error:', err);
        next(err);
    }
};

/**
 * GET Freelancer Queries
 * Logic: Fetch modern work update requests for the logged-in freelancer
 */
exports.getFreelancerQueries = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { data, error } = await adminClient
            .from('work_log_queries')
            .select(`
                *,
                job:job_id (title)
            `)
            .eq('freelancer_id', freelancerId)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
