const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * Fund Escrow (Demo Mode)
 * POST /api/fake-escrow/fund
 */
exports.fundEscrow = async (req, res, next) => {
    try {
        if (process.env.ESCROW_MODE !== 'FAKE' && process.env.VITE_ESCROW_MODE !== 'FAKE') {
            return res.status(403).json({ success: false, message: 'Fake escrow is only available in demo mode' });
        }
        const { contract_id, milestone_id, freelancer_id, amount } = req.body;
        const clientId = req.user.id;

        logger.info(`[FakeEscrow] Funding Request: Contract ${contract_id}, Milestone ${milestone_id}, Amount ${amount}`);

        // Input validation
        if (!contract_id || !amount) {
            return res.status(400).json({ success: false, message: 'contract_id and amount are required' });
        }

        // If milestone_id is missing, try to find the first milestone for this contract
        let targetMilestoneId = milestone_id;
        if (!targetMilestoneId) {
            const { data: milestones } = await adminClient
                .from('milestones')
                .select('id')
                .eq('contract_id', contract_id)
                .order('created_at', { ascending: true })
                .limit(1);
            
            if (milestones && milestones.length > 0) {
                targetMilestoneId = milestones[0].id;
                logger.info(`[FakeEscrow] Auto-resolved milestone_id: ${targetMilestoneId}`);
            }
        }

        // Fetch freelancer_id if missing
        let targetFreelancerId = freelancer_id;
        if (!targetFreelancerId) {
            const { data: contract } = await adminClient
                .from('contracts')
                .select('freelancer_id')
                .eq('id', contract_id)
                .single();
            if (contract) targetFreelancerId = contract.freelancer_id;
        }

        const { data, error } = await adminClient.rpc('process_fake_escrow_funding', {
            p_client_id: clientId,
            p_freelancer_id: targetFreelancerId,
            p_contract_id: contract_id,
            p_milestone_id: targetMilestoneId,
            p_amount: parseFloat(amount)
        });

        if (error) {
            logger.error('[FakeEscrow] Funding RPC Error:', error);
            throw error;
        }

        if (!data.success) {
            return res.status(400).json(data);
        }

        res.status(200).json(data);
    } catch (error) {
        logger.error('[FakeEscrow] fundEscrow Exception:', error);
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
            .from('escrow_ledger')
            .select('*')
            .eq('is_sandbox', true)
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

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
