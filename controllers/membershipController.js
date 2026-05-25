const Razorpay = require('razorpay');
const crypto = require('crypto');
const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');

/**
 * DYNAMIC MEMBERSHIP CONTROLLER (V2 MASTER)
 * Driven by DB plans, snapshotting, and secure payments.
 */

// Use environment variables for Razorpay keys
const rzpKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_SecimHMsWL2Ytk';
const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET || 'nrtFt7fdHj61zxwPj45cKZAD';
const razorpay = new Razorpay({
    key_id: rzpKeyId,
    key_secret: rzpKeySecret
});

/**
 * 1. GET ALL PLANS (Public)
 * GET /api/membership/plans
 */
exports.getPlans = async (req, res, next) => {
    try {
        const { data: plans, error } = await adminClient
            .from('membership_plans')
            .select('*, membership_features(*)')
            .eq('is_active', true)
            .order('price', { ascending: true });

        if (error) throw error;
        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        logger.error('Get Plans Error:', error);
        next(error);
    }
};

/**
 * 2. CREATE ORDER
 * POST /api/membership/create-order
 */
exports.createOrder = async (req, res, next) => {
    try {
        const { plan_id } = req.body;
        const userId = req.user.id;

        // 1. Fetch Plan Details from DB
        const { data: plan, error } = await adminClient
            .from('membership_plans')
            .select('*')
            .eq('id', plan_id)
            .single();

        if (error || !plan) {
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        // 2. Create Razorpay Order
        const options = {
            amount: plan.price, // Already in Paise/Smallest unit
            currency: "INR",
            receipt: `receipt_${Date.now()}_${userId.substring(0, 5)}`,
            notes: {
                user_id: userId,
                plan_id: plan_id,
                plan_name: plan.name
            }
        };

        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                key_id: rzpKeyId
            }
        });
    } catch (error) {
        logger.error('Create Order Error:', error);
        next(error);
    }
};

/**
 * 3. VERIFY PAYMENT (Fallback activation - Webhook is primary)
 * POST /api/membership/verify
 */
exports.verifyPayment = async (req, res, next) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_id } = req.body;
        const userId = req.user.id;

        logger.info(`[Membership] Verifying payment for user ${userId}, plan ${plan_id}`);

        // 1. Signature check
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', rzpKeySecret)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            logger.warn(`[Membership] Signature mismatch for order ${razorpay_order_id}`);
            return res.status(403).json({ success: false, message: 'Invalid payment signature' });
        }

        // 2. Idempotency Check (Support Recovery from partial failures)
        const { data: existing, error: existErr } = await adminClient
            .from('memberships')
            .select('id, plan_id')
            .eq('order_id', razorpay_order_id)
            .maybeSingle();
        
        if (existErr) logger.error('[Membership] Idempotency check error:', existErr);

        // 3. Fetch Plan & Features for Snapshot
        const effectivePlanId = existing ? existing.plan_id : plan_id;
        const { data: plan, error: planErr } = await adminClient
            .from('membership_plans')
            .select('*, features:membership_features(*)')
            .eq('id', effectivePlanId)
            .single();

        if (planErr || !plan) {
            logger.error('[Membership] Plan fetch failed for verify:', planErr || 'Plan not found');
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        // 4. Activate Membership (Only if not already done)
        if (!existing) {
            try {
                await adminClient.from('memberships').delete().eq('user_id', userId).eq('status', 'ACTIVE');
            } catch (delErr) {
                logger.warn('[Membership] Pre-active cleanup warning:', delErr.message);
            }

            const { error: insertErr } = await adminClient.from('memberships').insert([{
                user_id: userId,
                plan_id: effectivePlanId,
                status: 'ACTIVE',
                payment_id: razorpay_payment_id,
                order_id: razorpay_order_id,
                start_date: new Date().toISOString(),
                end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                updated_at: new Date().toISOString(),
                plan_snapshot: {
                    name: plan.name,
                    price: plan.price,
                    connects: plan.connects_per_month,
                    service_fee: plan.service_fee,
                    features: (plan.features || []).map(f => f.feature)
                }
            }]);

            if (insertErr) {
                logger.error('[Membership] Activation failed:', insertErr);
                return res.status(500).json({ success: false, message: 'DB Activation failed', error: insertErr });
            }
        }

        // 5. Credit Connects (Top-up logic handled via creditConnects RPC)
        try {
            await connectsService.creditConnects(
                userId, 
                plan.connects_per_month, 
                'membership_payment', 
                razorpay_order_id,
                { source: 'frontend_verify', plan: plan.name }
            );
        } catch (creditErr) {
            logger.error('[Membership] Initial connect credit failed:', creditErr.message);
        }

        // 6. Sync Profile
        try {
            const { error: profileErr } = await adminClient.from('profiles').update({ 
                membership_type: plan.name, 
                is_pro: true 
            }).eq('user_id', userId);
            if (profileErr) logger.error('[Membership] Profile sync error:', profileErr);
        } catch (syncErr) {
            logger.error('[Membership] Profile sync exception:', syncErr.message);
        }

        // 7. Fetch updated membership and connects balance to return to client
        let updatedMembership = null;
        let updatedBalance = 0;
        try {
            const { data: mData } = await adminClient
                .from('memberships')
                .select('plan_id, status, end_date, plan_snapshot, plan:membership_plans(name)')
                .eq('user_id', userId)
                .eq('status', 'ACTIVE')
                .maybeSingle();
            updatedMembership = mData;

            const { data: cData } = await adminClient
                .from('user_connects')
                .select('balance')
                .eq('user_id', userId)
                .maybeSingle();
            updatedBalance = cData?.balance ?? 0;
        } catch (fetchErr) {
            logger.error('[Membership] Failed to fetch updated data for response:', fetchErr.message);
        }

        res.status(200).json({ 
            success: true, 
            message: 'Payment verified and Plan activated!',
            data: {
                membership: updatedMembership,
                balance: updatedBalance
            }
        });

    } catch (error) {
        logger.error('Verify Payment Error:', error.message, error.stack);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during verification', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * 4. GET CURRENT MEMBERSHIP (Enriched)
 * GET /api/membership/current
 */
exports.getCurrentMembership = async (req, res, next) => {
    try {
        const { data: membership, error } = await adminClient
            .from('memberships')
            .select('*, plan:membership_plans(*)')
            .eq('user_id', req.user.id)
            .eq('status', 'ACTIVE')
            .maybeSingle();

        if (error) {
            logger.error('[Membership] Fetch error:', error);
            throw error;
        }

        // Apply Top-up check (Lazy evaluation on fetch)
        if (membership) {
            try {
                await connectsService.applyMonthlyTopup(req.user.id);
            } catch (topupErr) {
                logger.error('[Membership] Lazy topup check failed:', topupErr.message);
                // Don't crash the whole request if topup check fails
            }
        }

        return res.status(200).json({ success: true, data: membership });
    } catch (error) {
        logger.error('Get Current Membership Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 5. CREATE SALES PROPOSAL
 * POST /api/membership/sales-proposal
 */
exports.createSalesProposal = async (req, res, next) => {
    try {
        const { email, needs } = req.body;
        const userId = req.user?.id;

        if (!email || !needs) {
            return res.status(400).json({ success: false, message: 'Email and organizational needs are required' });
        }

        const { data, error } = await adminClient
            .from('membership_proposals')
            .insert([{
                user_id: userId || null,
                email,
                needs,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ success: true, message: 'Custom proposal request submitted successfully', data });
    } catch (error) {
        logger.error('Create Sales Proposal Error:', error);
        next(error);
    }
};

/**
 * 6. GET MY PROPOSALS
 * GET /api/membership/my-proposals
 */
exports.getMyProposals = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('membership_proposals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (error) {
        logger.error('Get My Proposals Error:', error);
        next(error);
    }
};

/**
 * 7. CREATE CUSTOM ORDER
 * POST /api/membership/create-custom-order
 */
exports.createCustomOrder = async (req, res, next) => {
    try {
        const { proposal_id } = req.body;
        const userId = req.user.id;

        if (!proposal_id) {
            return res.status(400).json({ success: false, message: 'Proposal ID is required' });
        }

        const { data: proposal, error } = await adminClient
            .from('membership_proposals')
            .select('*')
            .eq('id', proposal_id)
            .eq('user_id', userId)
            .single();

        if (error || !proposal) {
            return res.status(404).json({ success: false, message: 'Proposal not found' });
        }

        if (proposal.status !== 'REVIEWED') {
            return res.status(400).json({ success: false, message: 'Proposal is not ready for payment' });
        }

        if (!proposal.custom_price || proposal.custom_price <= 0) {
            return res.status(400).json({ success: false, message: 'Proposal does not have a valid price' });
        }

        // Create Razorpay Order (custom price in Rupees, so multiply by 100 to get Paise)
        const priceInPaise = Math.round(Number(proposal.custom_price) * 100);

        const options = {
            amount: priceInPaise,
            currency: "INR",
            receipt: `receipt_custom_${Date.now()}_${userId.substring(0, 5)}`,
            notes: {
                user_id: userId,
                proposal_id: proposal.id,
                plan_name: `CUSTOM PROPOSAL`
            }
        };

        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                key_id: rzpKeyId
            }
        });
    } catch (error) {
        logger.error('Create Custom Order Error:', error);
        next(error);
    }
};

/**
 * 8. VERIFY CUSTOM PAYMENT
 * POST /api/membership/verify-custom
 */
exports.verifyCustomPayment = async (req, res, next) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, proposal_id } = req.body;
        const userId = req.user.id;

        logger.info(`[Membership] Verifying custom payment for user ${userId}, proposal ${proposal_id}`);

        // 1. Signature check
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', rzpKeySecret)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            logger.warn(`[Membership] Signature mismatch for custom order ${razorpay_order_id}`);
            return res.status(403).json({ success: false, message: 'Invalid payment signature' });
        }

        // 2. Fetch Proposal Details
        const { data: proposal, error: propErr } = await adminClient
            .from('membership_proposals')
            .select('*')
            .eq('id', proposal_id)
            .eq('user_id', userId)
            .single();

        if (propErr || !proposal) {
            logger.error('[Membership] Proposal fetch failed for custom verify:', propErr || 'Proposal not found');
            return res.status(404).json({ success: false, message: 'Proposal not found' });
        }

        // 3. Activate Custom Membership
        try {
            await adminClient.from('memberships').delete().eq('user_id', userId).eq('status', 'ACTIVE');
        } catch (delErr) {
            logger.warn('[Membership] Pre-active custom cleanup warning:', delErr.message);
        }

        const priceInPaise = Math.round(Number(proposal.custom_price) * 100);

        const { error: insertErr } = await adminClient.from('memberships').insert([{
            user_id: userId,
            plan_id: null,
            status: 'ACTIVE',
            payment_id: razorpay_payment_id,
            order_id: razorpay_order_id,
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
            plan_snapshot: {
                name: "Custom Proposal",
                price: priceInPaise,
                connects: proposal.custom_connects || 100,
                service_fee: 5,
                features: proposal.custom_features || ["Custom Proposal Access"]
            }
        }]);

        if (insertErr) {
            logger.error('[Membership] Custom Activation failed:', insertErr);
            return res.status(500).json({ success: false, message: 'DB Custom Activation failed', error: insertErr });
        }

        // 4. Update Proposal status to RESOLVED
        await adminClient
            .from('membership_proposals')
            .update({ 
                status: 'RESOLVED', 
                accepted_at: new Date().toISOString(),
                updated_at: new Date().toISOString() 
            })
            .eq('id', proposal_id);

        // 5. Credit Connects
        try {
            await connectsService.creditConnects(
                userId, 
                proposal.custom_connects || 100, 
                'membership_payment', 
                razorpay_order_id,
                { source: 'custom_verify', plan: 'Custom Proposal' }
            );
        } catch (creditErr) {
            logger.error('[Membership] Custom initial connects credit failed:', creditErr.message);
        }

        // 6. Sync Profile
        try {
            await adminClient.from('profiles').update({ 
                membership_type: 'Custom Proposal',
                is_pro: true,
                updated_at: new Date().toISOString()
            }).eq('user_id', userId);
        } catch (profErr) {
            logger.error('[Membership] Custom profile sync failed:', profErr.message);
        }

        // 7. Fetch updated membership and connects balance to return to client
        let updatedMembership = null;
        let updatedBalance = 0;
        try {
            const { data: mData } = await adminClient
                .from('memberships')
                .select('plan_id, status, end_date, plan_snapshot, plan:membership_plans(name)')
                .eq('user_id', userId)
                .eq('status', 'ACTIVE')
                .maybeSingle();
            updatedMembership = mData;

            const { data: cData } = await adminClient
                .from('user_connects')
                .select('balance')
                .eq('user_id', userId)
                .maybeSingle();
            updatedBalance = cData?.balance ?? 0;
        } catch (fetchErr) {
            logger.error('[Membership] Failed to fetch updated custom data for response:', fetchErr.message);
        }

        res.status(200).json({ 
            success: true, 
            message: 'Custom Proposal membership activated successfully!',
            data: {
                membership: updatedMembership,
                balance: updatedBalance
            }
        });
    } catch (error) {
        logger.error('Verify Custom Payment Error:', error);
        next(error);
    }
};

