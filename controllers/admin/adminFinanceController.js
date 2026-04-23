const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

/**
 * Get all withdrawal requests
 */
exports.getWithdrawalRequests = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('withdrawals')
            .select('*', { count: 'exact' });

        if (status) query = query.eq('status', status);

        const { data, count, error } = await query
            .order('requested_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Approve or Reject withdrawal
 */
exports.processWithdrawal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // APPROVED or REJECTED

        const { error } = await supabase
            .from('withdrawals')
            .update({
                status,
                processed_at: new Date(),
                processed_by: req.user.id
            })
            .eq('id', id);

        if (error) throw error;

        await logAction(
            req.user.id,
            'WITHDRAWAL_PROCESS',
            id,
            `Withdrawal ${id} status set to ${status}`
        );

        res.status(200).json({
            success: true,
            message: `Withdrawal ${status.toLowerCase()} successfully`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update platform commission
 */
exports.updateCommission = async (req, res, next) => {
    try {
        const { percentage } = req.body;

        if (percentage < 0 || percentage > 100) {
            return res.status(400).json({ success: false, message: 'Invalid percentage' });
        }

        const { error } = await supabase
            .from('platform_settings')
            .upsert({
                setting_key: 'commission_percentage',
                setting_value: percentage.toString(),
                updated_at: new Date()
            }, { onConflict: 'setting_key' });

        if (error) throw error;

        await logAction(
            req.user.id,
            'SETTINGS_UPDATE',
            'COMMISSION',
            `Platform commission updated to ${percentage}%`
        );

        res.status(200).json({
            success: true,
            message: `Platform commission updated to ${percentage}%`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current platform settings
 */
exports.getPlatformSettings = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('*');

        if (error) throw error;

        const settings = {};
        data.forEach(s => settings[s.setting_key] = s.setting_value);

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};
