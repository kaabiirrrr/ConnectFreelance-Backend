const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');

/**
 * CONNECTS CONTROLLER (V2 MASTER)
 * Standardized Fintech logic for balance, history, and packages.
 */

const CONNECT_PACKAGES = [
    { id: 'starter', connects: 50, price: 25000 }, // 50 * 5 = 250 INR
    { id: 'professional', connects: 100, price: 50000, isBestValue: true }, // 100 * 5 = 500 INR
    { id: 'ultimate', connects: 200, price: 100000 } // 200 * 5 = 1000 INR
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
            description: tx.description || formatActionLabel(tx.action_source, tx.type),
            // Pull job_title from metadata JSONB for old records that didn't store reference_id
            _meta_job_title: tx.metadata?.job_title || null,
        }));

        // Enrich job_post entries with job title via reference_id (for newer records)
        const jobIds = signed
            .filter(tx => tx.action_source === 'job_post' && tx.reference_id)
            .map(tx => tx.reference_id);

        let jobTitleMap = {};
        if (jobIds.length > 0) {
            const { data: jobs } = await adminClient
                .from('jobs')
                .select('id, title')
                .in('id', jobIds);
            (jobs || []).forEach(j => { jobTitleMap[j.id] = j.title; });
        }

        const enriched = signed.map(tx => ({
            ...tx,
            // Priority: reference_id join > metadata.job_title > description already contains title
            job_title: (tx.reference_id && jobTitleMap[tx.reference_id])
                ? jobTitleMap[tx.reference_id]
                : (tx._meta_job_title || null),
        }));

        res.status(200).json({ success: true, data: enriched });
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

const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createPaymentIntent = async (req, res, next) => {
    try {
        const { packageId, promoCode } = req.body;
        const pkg = CONNECT_PACKAGES.find(p => p.id === packageId);
        
        if (!pkg) {
            return res.status(400).json({ success: false, message: "Invalid package selected" });
        }

        let amountPaise = pkg.price;
        
        // Handle promo code discount if applicable
        if (promoCode) {
            const { data: promo } = await adminClient
                .from('promo_codes')
                .select('*')
                .eq('code', promoCode.trim().toUpperCase())
                .eq('is_active', true)
                .maybeSingle();
                
            if (promo && promo.discount_percentage > 0) {
                const discountAmount = Math.floor(amountPaise * (promo.discount_percentage / 100));
                amountPaise -= discountAmount;
            }
        }

        const options = {
            amount: amountPaise,
            currency: 'INR',
            receipt: `rcpt_${req.user.id.substring(0, 8)}_${Date.now().toString(36)}`
        };

        const order = await razorpayInstance.orders.create(options);
        
        res.status(200).json({ 
            success: true, 
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            connects: pkg.connects + (pkg.connects_bonus || 0),
            razorpayKeyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        logger.error('[Connects] Create Payment Intent Error:', error);
        next(error);
    }
};

exports.confirmPayment = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            packageId
        } = req.body;

        const pkg = CONNECT_PACKAGES.find(p => p.id === packageId);
        if (!pkg) {
            return res.status(400).json({ success: false, message: "Invalid package" });
        }

        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: "Invalid payment signature" });
        }

        // Add connects
        const totalConnects = pkg.connects + (pkg.connects_bonus || 0);
        await connectsService.creditConnects(
            userId, 
            totalConnects, 
            'purchase', 
            null, 
            { package: pkg.id, payment_id: razorpay_payment_id }
        );

        // Fetch updated connects balance
        const { data: cData } = await adminClient
            .from('user_connects')
            .select('balance')
            .eq('user_id', userId)
            .maybeSingle();
        const updatedBalance = cData?.balance ?? 0;

        res.status(200).json({ 
            success: true, 
            message: `Successfully added ${totalConnects} connects!`,
            data: {
                balance: updatedBalance
            }
        });
    } catch (error) {
        logger.error('[Connects] Confirm Payment Error:', error);
        next(error);
    }
};
