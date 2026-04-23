const supabase = require('../supabase/client');
const logger = require('../utils/logger');

exports.getHealthStatus = async (req, res) => {
    try {
        const freelancerId = req.user.id;

        // Fetch profile stats
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('profile_completion_percentage, email_verified, is_verified')
            .eq('user_id', freelancerId)
            .single();

        if (error) {
            logger.error('Error fetching profile for health status', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch status' });
        }

        // Fetch violations to determine account status
        const { data: violations, error: vError } = await supabase
            .from('freelancer_enforcement_history')
            .select('*')
            .eq('freelancer_id', freelancerId)
            .eq('status', 'active');
        
        let accountStatus = 'GOOD';
        if (violations && violations.length > 0) {
            const hasHighSeverity = violations.some(v => v.severity === 'high');
            accountStatus = hasHighSeverity ? 'RESTRICTED' : 'WARNING';
        }

        res.status(200).json({
            success: true,
            data: {
                profile_completion: profile?.profile_completion_percentage || 0,
                identity_verified: profile?.is_verified || false,
                email_verified: profile?.email_verified || false,
                account_status: accountStatus
            }
        });

    } catch (error) {
        logger.error('Health Status Error', error);
        res.status(500).json({ success: false, message: 'Server error fetching health status' });
    }
};

exports.getHealthScore = async (req, res) => {
    try {
        const freelancerId = req.user.id;
        
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('account_health_score')
            .eq('user_id', freelancerId)
            .single();

        if (error) {
            logger.error('Error fetching health score', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch health score' });
        }

        res.status(200).json({
            success: true,
            data: {
                health_score: profile?.account_health_score || 100
            }
        });
    } catch (error) {
        logger.error('Health Score Error', error);
        res.status(500).json({ success: false, message: 'Server error fetching health score' });
    }
};

exports.getViolations = async (req, res) => {
    try {
        const freelancerId = req.user.id;

        const { data: violations, error } = await supabase
            .from('freelancer_enforcement_history')
            .select('*')
            .eq('freelancer_id', freelancerId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Error fetching violations', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch enforcement history' });
        }

        const { data: appeals, error: appealsError } = await supabase
            .from('freelancer_violation_appeals')
            .select('*')
            .eq('freelancer_id', freelancerId);

        res.status(200).json({
            success: true,
            data: {
                violations_count: violations?.length || 0,
                appeals_count: appeals?.length || 0,
                history: violations || [],
                appeals: appeals || []
            }
        });
    } catch (error) {
        logger.error('Violations Fetch Error', error);
        res.status(500).json({ success: false, message: 'Server error fetching violations' });
    }
};

exports.getPolicies = async (req, res) => {
    try {
        const { data: policies, error } = await supabase
            .from('freelancer_policy_documents')
            .select('id, slug, title')
            .order('title', { ascending: true });
        
        if (error) {
             return res.status(500).json({ success: false, message: 'Failed to fetch policies' });
        }

        res.status(200).json({ success: true, data: policies });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error fetching policies' });
    }
};

exports.getPolicyBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const { data: policy, error } = await supabase
            .from('freelancer_policy_documents')
            .select('*')
            .eq('slug', slug)
            .single();
        
        if (error || !policy) {
             return res.status(404).json({ success: false, message: 'Policy not found' });
        }

        res.status(200).json({ success: true, data: policy });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error fetching policy' });
    }
};

exports.getBestPractices = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('freelancer_best_practice_guides')
            .select('*')
            .order('priority', { ascending: true });
            
        if (error) return res.status(500).json({ success: false, message: 'Failed to fetch best practices' });

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getSuccessRoadmap = async (req, res) => {
     try {
        const { data, error } = await supabase
            .from('freelancer_success_roadmap')
            .select('*')
            .order('step_number', { ascending: true });
            
        if (error) return res.status(500).json({ success: false, message: 'Failed to fetch success roadmap' });

        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.submitAppeal = async (req, res) => {
    try {
        const freelancerId = req.user.id;
        const { violation_id, appeal_text } = req.body;

        if (!violation_id || !appeal_text) {
            return res.status(400).json({ success: false, message: 'Violation ID and appeal text are required' });
        }

        const { data, error } = await supabase
            .from('freelancer_violation_appeals')
            .insert([{
                freelancer_id: freelancerId,
                violation_id,
                appeal_text,
                status: 'pending'
            }])
            .select();

        if (error) {
            logger.error('Submit appeal error', error);
            return res.status(500).json({ success: false, message: 'Failed to submit appeal' });
        }

        // Also update violation status to appealed
        await supabase
            .from('freelancer_enforcement_history')
            .update({ status: 'appealed' })
            .eq('id', violation_id);

        res.status(201).json({ success: true, message: 'Appeal submitted successfully', data: data[0] });

    } catch (error) {
        logger.error('Submit Appeal exception', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
