const adminClient = require('../supabase/adminClient');

exports.getAccounts = async (req, res, next) => {
    try {
        const { data, error } = await adminClient
            .from('bank_accounts')
            .select('*')
            .eq('user_id', req.user.id)
            .order('is_default', { ascending: false });
        if (error) throw error;
        res.status(200).json({ success: true, data: data || [] });
    } catch (err) { next(err); }
};

exports.addAccount = async (req, res, next) => {
    try {
        const { bank_name, account_holder, account_number, ifsc_code } = req.body;
        if (!bank_name || !account_number || !ifsc_code) {
            return res.status(400).json({ success: false, message: 'bank_name, account_number and ifsc_code are required' });
        }
        // First account becomes default
        const { count } = await adminClient.from('bank_accounts').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id);
        const { data, error } = await adminClient
            .from('bank_accounts')
            .insert([{ user_id: req.user.id, bank_name, account_holder, account_number, ifsc_code, is_default: count === 0 }])
            .select().single();
        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
};

exports.deleteAccount = async (req, res, next) => {
    try {
        const { error } = await adminClient.from('bank_accounts').delete().eq('id', req.params.id).eq('user_id', req.user.id);
        if (error) throw error;
        res.status(200).json({ success: true, message: 'Account removed' });
    } catch (err) { next(err); }
};

exports.setDefault = async (req, res, next) => {
    try {
        // Unset all defaults first
        await adminClient.from('bank_accounts').update({ is_default: false }).eq('user_id', req.user.id);
        const { data, error } = await adminClient
            .from('bank_accounts').update({ is_default: true }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) { next(err); }
};
