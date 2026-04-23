const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');

/**
 * CONNECTS CONTROLLER (V2 MASTER)
 * Standardized Fintech logic for balance, history, and packages.
 */

const CONNECT_PACKAGES = [
    { id: 'small', connects: 50, price: 50000 }, // price in paise (INR 500)
    { id: 'medium', connects: 100, connects_bonus: 20, price: 90000, isBestValue: true },
    { id: 'large', connects: 250, connects_bonus: 50, price: 200000 }
];

/**
 * 1. GET PACKAGES
 */
exports.getPackages = async (req, res) => {
    res.status(200).json({ success: true, data: CONNECT_PACKAGES });
};

/**
 * 2. GET CURRENT BALANCE & NEXT TOPUP
 * GET /api/connects/balance
 */
exports.getBalance = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        
        // Lazy-trigger topup check
        try {
            await connectsService.applyMonthlyTopup(userId);
        } catch (tErr) {
            logger.error('[Connects] Lazy topup error:', tErr.message);
        }

        const { data, error } = await adminClient
            .from('user_connects')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        // If no wallet exists yet, initialize it
        if (!data) {
            const { data: newWallet } = await adminClient
                .from('user_connects')
                .insert([{ user_id: userId, balance: 20 }])
                .select()
                .single();
            return res.status(200).json({ success: true, data: newWallet });
        }

        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('[Connects] Get Balance Error:', error);
        next(error);
    }
};

/**
 * 3. GET TRANSACTION HISTORY
 * GET /api/connects/history
 */
exports.getHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { typeFilter, dateFilter } = req.query;

        let query = adminClient
            .from('connect_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        // Date filter
        if (dateFilter) {
            const days = parseInt(dateFilter);
            if (!isNaN(days)) {
                const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                query = query.gte('created_at', since);
            }
        }

        // Type filter
        if (typeFilter === 'all_debits') query = query.eq('type', 'DEBIT');
        else if (typeFilter === 'all_credits') query = query.eq('type', 'CREDIT');
        else if (typeFilter) query = query.ilike('action_source', `%${typeFilter}%`);

        const { data, error } = await query;
        if (error) throw error;

        // Return signed amounts: debits as negative
        const signed = (data || []).map(tx => ({
            ...tx,
            amount: tx.type === 'DEBIT' ? -Math.abs(tx.amount) : Math.abs(tx.amount),
            description: tx.description || formatActionLabel(tx.action_source, tx.type)
        }));

        res.status(200).json({ success: true, data: signed });
    } catch (error) {
        next(error);
    }
};

function formatActionLabel(actionSource, type) {
    const labels = {
        job_post: 'Job Posted',
        proposal_submit: 'Proposal Submitted',
        proposal_accept: 'Freelancer Hired',
        membership_payment: 'Membership Purchase',
        monthly_free: 'Monthly Top-up',
        promo_redemption: 'Promo Code Redeemed',
        purchase: 'Connects Purchased',
    };
    return labels[actionSource] || (type === 'DEBIT' ? 'Deduction' : 'Credit');
}

/**
 * 4. APPLY PROMO CODE
 * POST /api/connects/apply-promo
 */
exports.applyPromoCode = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { code } = req.body;

        const { data: promo, error } = await adminClient
            .from('promo_codes')
            .select('*')
            .eq('code', code.trim().toUpperCase())
            .eq('is_active', true)
            .maybeSingle();

        if (error || !promo) return res.status(404).json({ success: false, message: 'Invalid or expired promo code' });

        // Logic for connects reward
        if (promo.connects_reward > 0) {
            // Check redemption
            const { data: existing } = await adminClient
                .from('promo_code_redemptions')
                .select('id')
                .eq('promo_code_id', promo.id)
                .eq('user_id', userId)
                .maybeSingle();

            if (existing) return res.status(400).json({ success: false, message: 'Code already used' });

            await connectsService.creditConnects(
                userId,
                promo.connects_reward,
                'promo_redemption',
                null,
                { code: promo.code }
            );

            await adminClient.from('promo_code_redemptions').insert([{ promo_code_id: promo.id, user_id: userId }]);
            
            return res.status(200).json({ success: true, message: `${promo.connects_reward} Connects added!` });
        }

        res.status(200).json({ success: true, data: { discount: promo.discount_percentage } });
    } catch (error) {
        next(error);
    }
};

/**
 * 5. GET GLOBAL SETTINGS
 */
exports.getSettings = async (req, res, next) => {
    try {
        const settings = await connectsService.getSettings();
        res.status(200).json({ success: true, data: settings });
    } catch (err) {
        next(err);
    }
};

// Logic for buying connect packs (to be integrated with Razorpay if needed)
exports.createPaymentIntent = async (req, res) => res.status(501).json({ message: "Use membership for connects refill" });
exports.confirmPayment = async (req, res) => res.status(501).json({ message: "Use membership for connects refill" });
