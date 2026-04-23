const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const { STATUS } = require('../utils/interventionEngine');

/**
 * Get all ACTIVE interventions for the current user.
 * If user is FREELANCER, get ones where they are involved.
 * If user is CLIENT, get ones for their jobs.
 */
exports.getActiveInterventions = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let query = adminClient
            .from('interventions')
            .select(`
                *,
                job:jobs(title),
                contract:contracts(id, title)
            `)
            .eq('status', STATUS.ACTIVE)
            .order('created_at', { ascending: false });

        if (role === 'FREELANCER') {
            query = query.eq('freelancer_id', userId);
        } else if (role === 'CLIENT') {
            // Get interventions for jobs owned by this client
            const { data: jobIds } = await adminClient
                .from('jobs')
                .select('id')
                .eq('client_id', userId);
            
            if (jobIds?.length > 0) {
                query = query.in('job_id', jobIds.map(j => j.id));
            } else {
                return res.status(200).json({ success: true, data: [] });
            }
        } else if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
            // Admins see everything
        } else {
            return res.status(200).json({ success: true, data: [] });
        }

        const { data, error } = await query;

        if (error) throw error;

        res.status(200).json({ success: true, data });

    } catch (err) {
        logger.error('Get Active Interventions Error:', err);
        next(err);
    }
};

/**
 * Manually dismiss an intervention (moves to RESOLVED or a new status like DISMISSED).
 */
exports.resolveIntervention = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { error } = await adminClient
            .from('interventions')
            .update({ 
                status: STATUS.RESOLVED, 
                updated_at: new Date().toISOString(),
                resolved_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Intervention resolved.' });
    } catch (err) {
        next(err);
    }
};

/**
 * Get Intervention Impact Metrics (Analytics)
 */
exports.getInterventionStats = async (req, res, next) => {
    try {
        const { data: allInterventions, error } = await adminClient
            .from('interventions')
            .select('type, status, created_at, resolved_at');

        if (error) throw error;

        const total = allInterventions.length;
        if (total === 0) {
            return res.status(200).json({
                success: true,
                data: { total: 0, avgResolutionTime: 0, escalationRate: 0 }
            });
        }

        const escalations = allInterventions.filter(i => i.type === 'escalation').length;
        const resolved = allInterventions.filter(i => i.resolved_at);

        let totalResolutionTime = 0;
        resolved.forEach(i => {
           const duration = (new Date(i.resolved_at) - new Date(i.created_at)) / (1000 * 60 * 60); // In hours
           totalResolutionTime += duration;
        });

        const stats = {
            totalInterventions: total,
            escalationRate: ((escalations / total) * 100).toFixed(2) + '%',
            avgResolutionTimeHours: resolved.length > 0 ? (totalResolutionTime / resolved.length).toFixed(2) : 0,
            activeCount: allInterventions.filter(i => i.status === STATUS.ACTIVE).length
        };

        res.status(200).json({ success: true, data: stats });
    } catch (err) {
        logger.error('Get Intervention Stats Error:', err);
        next(err);
    }
};
