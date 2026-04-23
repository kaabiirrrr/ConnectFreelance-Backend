const supabase = require('../supabase/client');
const logger = require('../utils/logger');

/**
 * Fund Escrow (Demo Mode)
 * POST /api/fake-escrow/fund
 */
exports.fundEscrow = async (req, res, next) => {
    try {
        const { contract_id, milestone_id, freelancer_id, amount } = req.body;
        const clientId = req.user.id;

        if (process.env.ESCROW_MODE !== 'FAKE') {
            return res.status(403).json({ success: false, message: 'Fake escrow is only available in demo mode' });
        }

        const { data, error } = await supabase.rpc('process_fake_escrow_funding', {
            p_client_id: clientId,
            p_freelancer_id: freelancer_id,
            p_contract_id: contract_id,
            p_milestone_id: milestone_id,
            p_amount: parseFloat(amount)
        });

        if (error) throw error;
        if (!data.success) return res.status(400).json(data);

        res.status(200).json({ success: true, message: 'Demo escrow funded successfully', data });
    } catch (error) {
        next(error);
    }
};

/**
 * Release Payment (Demo Mode)
 * POST /api/fake-escrow/release
 */
exports.releaseEscrow = async (req, res, next) => {
    try {
        const { transaction_id } = req.body;

        if (process.env.ESCROW_MODE !== 'FAKE') {
            return res.status(403).json({ success: false, message: 'Fake escrow is only available in demo mode' });
        }

        const { data, error } = await supabase.rpc('process_fake_escrow_release', {
            p_transaction_id: transaction_id
        });

        if (error) throw error;
        if (!data.success) return res.status(400).json(data);

        res.status(200).json({ success: true, message: 'Demo payment released successfully', data });
    } catch (error) {
        next(error);
    }
};

/**
 * Reset Wallet (Demo Mode)
 * POST /api/fake-escrow/reset
 */
exports.resetWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;

        if (process.env.ESCROW_MODE !== 'FAKE') {
            return res.status(403).json({ success: false, message: 'Reset is only available in demo mode' });
        }

        const { error } = await supabase.rpc('reset_demo_wallet', {
            p_user_id: userId
        });

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Wallet reset to 10,000 demo credits' });
    } catch (error) {
        next(error);
    }
};

/**
 * Get Wallet Balance
 * GET /api/fake-escrow/balance
 */
exports.getBalance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const adminClient = require('../supabase/adminClient');

        let wallet = null;
        const { data, error } = await adminClient
            .from('wallets')
            .select('available_balance, pending_balance')
            .eq('user_id', userId)
            .maybeSingle();

        if (!error) wallet = data;

        // Auto-create wallet if missing
        if (!wallet) {
            const { data: newWallet } = await adminClient
                .from('wallets')
                .insert([{ user_id: userId, available_balance: 10000, pending_balance: 0 }])
                .select('available_balance, pending_balance')
                .single();
            wallet = newWallet;
        }

        res.status(200).json({
            success: true,
            data: {
                balance: wallet ? parseFloat(wallet.available_balance) : 10000,
                pending_balance: wallet ? parseFloat(wallet.pending_balance) : 0
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getTransactions = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contract_id } = req.query;

        let query = supabase
            .from('fake_escrow_transactions')
            .select('*')
            .or(`client_id.eq.${userId},freelancer_id.eq.${userId}`);

        if (contract_id) {
            query = query.eq('contract_id', contract_id);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};
