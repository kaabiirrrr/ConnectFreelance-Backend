const supabase = require('../supabase/client');
const logger = require('../utils/logger');

/**
 * Toggle bookmark on a job (add if not bookmarked, remove if bookmarked)
 * POST /api/bookmarks/toggle
 * Security: Any authenticated user
 */
exports.toggleBookmark = async (req, res, next) => {
    try {
        const { job_id } = req.body;
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');

        // Check if bookmark exists
        const { data: existing, error: checkError } = await adminClient
            .from('saved_jobs')
            .select('id')
            .eq('freelancer_id', userId)
            .eq('job_id', job_id)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existing) {
            // Remove bookmark
            const { error: deleteError } = await adminClient
                .from('saved_jobs')
                .delete()
                .eq('freelancer_id', userId)
                .eq('job_id', job_id);

            if (deleteError) throw deleteError;

            return res.status(200).json({
                success: true,
                data: { bookmarked: false },
                message: 'Bookmark removed'
            });
        }

        // Add bookmark
        const { error: insertError } = await adminClient
            .from('saved_jobs')
            .insert([{ freelancer_id: userId, job_id }]);

        if (insertError) throw insertError;

        res.status(201).json({
            success: true,
            data: { bookmarked: true },
            message: 'Job bookmarked'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user's bookmarked jobs (with full job data)
 * GET /api/bookmarks
 * Security: Authenticated user
 */
exports.getBookmarks = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
        const offset = (page - 1) * limit;

        const { data: bookmarks, error, count } = await adminClient
            .from('saved_jobs')
            .select(`
                job_id, created_at,
                jobs:job_id (
                    id, title, description, category, skills, budget_type,
                    budget_amount, status, created_at,
                    client:client_id ( id, name, avatar_url, company_name, country, location, rating, reviews_count )
                )
            `, { count: 'exact' })
            .eq('freelancer_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const totalPages = Math.ceil((count || 0) / limit);

        res.status(200).json({
            success: true,
            data: bookmarks || [],
            pagination: { page, limit, total: count || 0, totalPages }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Check if a specific job is bookmarked
 * GET /api/bookmarks/check/:jobId
 * Security: Authenticated user
 */
exports.checkBookmark = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');

        const { data, error } = await adminClient
            .from('saved_jobs')
            .select('id')
            .eq('freelancer_id', userId)
            .eq('job_id', jobId)
            .maybeSingle();

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: { bookmarked: !!data }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all saved job IDs for the current user (for bulk highlighting)
 * GET /api/bookmarks/ids
 * Security: FREELANCER only
 */
exports.getSavedJobIds = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');

        const { data, error } = await adminClient
            .from('saved_jobs')
            .select('job_id')
            .eq('freelancer_id', userId);

        if (error) throw error;

        const ids = (data || []).map(b => b.job_id);
        res.status(200).json({ success: true, data: ids });
    } catch (error) {
        next(error);
    }
};

/**
 * Get saved jobs with full job data (for the Saved Jobs tab)
 * GET /api/bookmarks/saved-jobs
 * Security: FREELANCER only — returns jobs in the same shape as /api/jobs/recent
 */
exports.getSavedJobs = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');

        // 1. Fetch bookmarked job IDs
        const { data: bookmarks, error: bookmarkErr } = await adminClient
            .from('saved_jobs')
            .select('job_id, created_at')
            .eq('freelancer_id', userId)
            .order('created_at', { ascending: false });

        if (bookmarkErr) throw bookmarkErr;

        if (!bookmarks || bookmarks.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        const jobIds = bookmarks.map(b => b.job_id);

        // 2. Fetch jobs
        const { data: jobs, error: jobErr } = await adminClient
            .from('jobs')
            .select('*')
            .in('id', jobIds)
            .eq('is_bidding_open', true)
            .neq('status', 'DRAFT');

        if (jobErr) throw jobErr;

        // Create map to keep original bookmark sorting
        let jobMap = {};
        if (jobs) jobs.forEach(j => { jobMap[j.id] = j; });

        // Extract client IDs (client_id from jobs table)
        const clientIds = [...new Set((jobs || []).map(j => j.client_id).filter(Boolean))];
        let profileMap = {};
        
        // 3. Enrich with client profile
        if (clientIds.length > 0) {
            const { data: profiles } = await adminClient
                .from('profiles')
                .select('user_id, name, company_name, avatar_url, country, location, rating, reviews_count')
                .in('user_id', clientIds);
            if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });
        }

        // Reconstruct sorted output
        const sortedEnrichedJobs = bookmarks.map(b => {
            const job = jobMap[b.job_id];
            if (!job) return null; // job might be closed or deleted
            return {
                ...job,
                saved_at: b.created_at, // useful for UI
                client: profileMap[job.client_id] || null
            };
        }).filter(Boolean);

        res.status(200).json({ success: true, data: sortedEnrichedJobs });
    } catch (error) {
        logger.error('[Bookmarks] getSavedJobs error', error);
        next(error);
    }
};
