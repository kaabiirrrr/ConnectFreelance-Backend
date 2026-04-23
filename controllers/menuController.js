const supabase = require('../supabase/client');

exports.getSubmenus = async (req, res, next) => {
    try {
        const { menuKey } = req.query;
        const key = menuKey || 'client_submenus';

        const { data, error } = await supabase
            .from('platform_settings')
            .select('setting_value')
            .eq('setting_key', key)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        res.status(200).json({
            success: true,
            data: data ? data.setting_value : [],
            message: 'Submenus retrieved'
        });
    } catch (error) {
        next(error);
    }
};

exports.addSubmenu = async (req, res, next) => {
    try {
        const { menuKey, newSubmenus } = req.body; 
        const key = menuKey || 'client_submenus';

        if (!newSubmenus) {
            return res.status(400).json({ success: false, message: 'Missing submenu data' });
        }

        const { data, error } = await supabase
            .from('platform_settings')
            .upsert({
                setting_key: key,
                setting_value: newSubmenus,
                description: `Dynamic submenus for ${key}`
            }, { onConflict: 'setting_key' })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data: data.setting_value,
            message: 'Submenus updated successfully'
        });
    } catch (error) {
        next(error);
    }
};
