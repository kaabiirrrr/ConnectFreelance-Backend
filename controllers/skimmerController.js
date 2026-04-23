const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { recalculateProjectHealth } = require('../services/skimmerEngine');
const { generateProjectPlan, generateProjectAdvice } = require('../services/skimmerAIService');

/**
 * Controller for Skimmer Co-Pilot Dashboard
 */

exports.getProjectOverview = async (req, res, next) => {
    try {
        const { jobId } = req.params;

        const { data: insight, error } = await adminClient
            .from('project_insights')
            .select('*')
            .eq('job_id', jobId)
            .maybeSingle();

        if (error) {
            // Table may not exist yet — return safe fallback
            if (error.code === '42P01' || error.message?.includes('schema cache')) {
                return res.status(200).json({ success: true, data: { health_score: 0, change_value: 0, delay_risk: 0, team_efficiency: 0 } });
            }
            throw error;
        }

        if (!insight) {
            try {
                const fresh = await recalculateProjectHealth(jobId);
                return res.status(200).json({ success: true, data: fresh });
            } catch (_) {
                return res.status(200).json({ success: true, data: { health_score: 0, change_value: 0, delay_risk: 0, team_efficiency: 0 } });
            }
        }

        res.status(200).json({ success: true, data: insight });
    } catch (err) {
        next(err);
    }
};

exports.getProjectTasks = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const userId = req.user.id;

        const { data: tasks, error } = await adminClient
            .from('project_tasks')
            .select('*')
            .eq('job_id', jobId)
            .eq('is_active', true)
            .order('created_at', { ascending: true });

        if (error) {
            // Table may not exist yet — return empty list
            if (error.code === '42P01' || error.message?.includes('schema cache')) {
                return res.status(200).json({ success: true, data: [] });
            }
            throw error;
        }

        if (req.user.role === 'FREELANCER') {
            const filteredTasks = tasks.filter(t => t.assigned_to === userId || t.role?.toLowerCase().includes('freelancer'));
            return res.status(200).json({ success: true, data: filteredTasks });
        }

        res.status(200).json({ success: true, data: tasks || [] });
    } catch (err) {
        next(err);
    }
};

exports.getAIInsights = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        const { data: insight, error } = await adminClient
            .from('project_insights')
            .select('health_score, delay_risk, team_efficiency')
            .eq('job_id', jobId)
            .single();

        if (error || !insight) {
            return res.status(200).json({ success: true, data: { summary: "Project plan pending.", client_action: "Ensure requirements are clearly communicated.", freelancer_action: "Update work logs regularly." } });
        }

        const advice = await generateProjectAdvice(jobId, insight);
        res.status(200).json({ success: true, data: advice });
    } catch (err) {
        next(err);
    }
};

exports.regeneratePlan = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        const { data: job, error } = await adminClient
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (error || !job) return res.status(404).json({ success: false, message: 'Job not found' });

        const result = await generateProjectPlan(job);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

exports.getHealthHistory = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { data, error } = await adminClient
            .from('project_health_history')
            .select('health_score, change_value, created_at')
            .eq('job_id', jobId)
            .order('created_at', { ascending: true })
            .limit(30);

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
