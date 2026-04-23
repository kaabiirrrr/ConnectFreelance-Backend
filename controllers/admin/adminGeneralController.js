const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

/**
 * Skills Management
 */
exports.addSkill = async (req, res, next) => {
    try {
        const { name, category } = req.body;
        const { data, error } = await supabase
            .from('skills')
            .insert({ name, category })
            .select()
            .single();

        if (error) throw error;

        await logAction(req.user.id, 'SKILL_ADD', data.id.toString(), `Added skill: ${name}`);

        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

exports.deleteSkill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('skills').delete().eq('id', id);
        if (error) throw error;

        await logAction(req.user.id, 'SKILL_DELETE', id, `Deleted skill ID: ${id}`);
        res.status(200).json({ success: true, message: 'Skill deleted' });
    } catch (error) {
        next(error);
    }
};

/**
 * Announcements Management
 */
exports.createAnnouncement = async (req, res, next) => {
    try {
        const { title, message, target_role } = req.body;
        const { data, error } = await supabase
            .from('announcements')
            .insert({
                title,
                message,
                target_role,
                created_by: req.user.id
            })
            .select()
            .single();

        if (error) throw error;

        await logAction(req.user.id, 'ANNOUNCEMENT_CREATE', data.id, `Created announcement: ${title}`);

        res.status(201).json({ success: true, data });
    } catch (error) {
        logger.error('Error in createAnnouncement', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create announcement',
            error: error
        });
    }
};

exports.getAnnouncements = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

/**
 * Fraud Monitoring - Basic Implementation
 */
exports.getSuspiciousUsers = async (req, res, next) => {
    try {
        // Example suspicious activity query: Users with frequent job cancellations
        // In a real scenario, this would involve complex joins or activity tracking tables
        const { data, error } = await supabase
            .from('users')
            .select(`
                id,
                email,
                profiles (
                    name
                )
            `);

        // Note: This is an illustrative query. 
        // Real fraud detection would use dedicated tables for IP tracking and proposal velocity.

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};
