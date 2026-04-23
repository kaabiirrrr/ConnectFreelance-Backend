const supabase = require('../../supabase/adminClient');

exports.getSettings = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('*');

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

exports.updateSetting = async (req, res, next) => {
    try {
        const { key } = req.params;
        const { value, description } = req.body;

        // Upsert setting
        const { data, error } = await supabase
            .from('platform_settings')
            .upsert({
                setting_key: key,
                setting_value: value,
                description: description || null,
                updated_at: new Date()
            }, { onConflict: 'setting_key' })
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Setting updated successfully' });
    } catch (error) {
        next(error);
    }
};
