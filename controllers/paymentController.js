const stripe = require('../stripe/client');
const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Lazy-loaded Razorpay client to prevent boot crashes if keys are missing
let _razorpay = null;
const getRazorpayClient = () => {
    if (_razorpay) return _razorpay;

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error('Razorpay keys are missing. Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }

    _razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
    return _razorpay;
};

exports.createIntent = async (req, res, next) => {
    try {
        const { contract_id, amount } = req.body;
        const clientId = req.user.id;

        // Verify contract ownership
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, client_id, freelancer_id, status')
            .eq('id', contract_id)
            .single();

        if (contractError) throw contractError;
        if (contract.client_id !== clientId) return res.status(403).json({ success: false, data: null, message: 'Not authorized for this contract' });

        // Calculate amount in cents
        const amountInCents = Math.round(amount * 100);

        // Create Payment Intent with escrow capture method
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            capture_method: 'manual', 
            metadata: {
                contract_id,
                milestone_id: req.body.milestone_id || null, // LINK TO MILESTONE
                client_id: clientId,
                freelancer_id: contract.freelancer_id,
                type: 'escrow_deposit'
            }
        });

        res.status(200).json({
            success: true,
            data: {
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id
            },
            message: 'Payment intent created successfully'
        });
    } catch (error) {
        next(error);
    }
};

exports.escrowDeposit = async (req, res, next) => {
    try {
        const { contract_id, milestone_id, payment_intent_id } = req.body;
        const clientId = req.user.id;

        // 1. VERIFY WITH STRIPE (Zero trust approach)
        const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (intent.status !== 'requires_capture') {
            return res.status(400).json({ success: false, message: 'Payment not authorized on Stripe' });
        }

        const actualAmount = intent.amount / 100; // Convert cents to dollars

        // 2. ATOMIC DB UPDATE (Wallet Hold + Milestone status)
        const { data, error } = await supabase.rpc('process_escrow_funding', {
            p_contract_id: contract_id,
            p_milestone_id: milestone_id,
            p_client_id: clientId,
            p_amount: actualAmount,
            p_stripe_pi_id: payment_intent_id
        });

        if (error) throw error;
        if (!data.success) return res.status(400).json(data);

        // 3. Record Payment Record (Audit)
        await supabase.from('payments').insert([{
            contract_id,
            payer_id: clientId,
            payee_id: intent.metadata.freelancer_id,
            stripe_payment_intent_id: payment_intent_id,
            amount: actualAmount,
            status: 'requires_capture',
            description: 'Funds held in enterprise escrow'
        }]);

        res.status(200).json({ success: true, message: 'Funds securely held in escrow' });
    } catch (error) {
        next(error);
    }
};

exports.releaseEscrow = async (req, res, next) => {
    try {
        const { milestone_id } = req.body;
        const clientId = req.user.id;

        // 1. Fetch payment record linked to milestone
        const { data: payment } = await supabase
            .from('payments')
            .select('id, stripe_payment_intent_id, status')
            .eq('contract_id', req.body.contract_id) // simplified, usually linked by milestone
            .eq('status', 'requires_capture')
            .maybeSingle();

        if (!payment) return res.status(404).json({ success: false, message: 'No funded escrow found for this release' });

        // 2. Capture on Stripe
        const paymentIntent = await stripe.paymentIntents.capture(payment.stripe_payment_intent_id);

        if (paymentIntent.status === 'succeeded') {
            // 3. ATOMIC DB RELEASE (Bank-Grade v5)
            // Includes: Triple Wallet Lock, 80/20 Revenue Split, and Circuit Breaker
            const { executeWithRetry } = require('../utils/dbUtils');
            const crypto = require('crypto');
            
            // For idempotency, we use the Stripe PI ID itself or a deterministic UUID derived from it
            const idempotencyKey = crypto.createHash('md5').update(payment.stripe_payment_intent_id + '_release').digest('hex');

            const rpcRes = await executeWithRetry(async () => {
                const { data, error } = await supabase.rpc('process_escrow_release_v5', {
                    p_milestone_id: milestone_id,
                    p_client_id: clientId,
                    p_idempotency_key: payment.stripe_payment_intent_id // Use PI ID as key (UNIQUE in DB)
                });
                if (error) throw error;
                return data;
            });

            if (!rpcRes.success) {
                logger.error('CRITICAL: Stripe capture succeeded but DB release failed!', rpcRes.message);
                
                // --- LOCK DOWN ORPHANED STATE ---
                // Even if the release failed, we must record that funds are captured on Stripe
                // but not yet distributed in the DB.
                await supabase
                    .from('payments')
                    .update({ 
                        status: 'orphaned_payment', 
                        reconciliation_needed: true,
                        last_error: rpcRes.message 
                    })
                    .eq('id', payment.id);

                return res.status(500).json({ 
                    success: false, 
                    message: `Partial failure: Funds captured in Stripe but DB release failed. ${rpcRes.message}`,
                    requires_reconciliation: true,
                    pi_id: payment.stripe_payment_intent_id
                });
            }


            // 4. Finalize payment record
            await supabase.from('payments').update({ status: 'released' }).eq('id', payment.id);

            res.status(200).json({ success: true, message: 'Payment released and wallet updated atomically' });
        } else {
            res.status(400).json({ success: false, message: 'Failed to capture payment intent on Stripe' });
        }
    } catch (error) {
        next(error);
    }
};

exports.refundEscrow = async (req, res, next) => {
    try {
        const { payment_id } = req.body;
        const userId = req.user.id; // Either admin, or client cancelling, or freelancer refunding

        // Fetch payment with contract details for authorization
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .select(`
                id, stripe_payment_intent_id, amount, status,
                contracts (client_id)
            `)
            .eq('id', payment_id)
            .single();

        if (paymentError) throw paymentError;

        // Authorization check: Only original client or an admin can refund/cancel escrow
        const isClient = payment.contracts.client_id === userId;
        const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN'].includes(req.user.role);

        if (!isClient && !isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Not authorized to refund this payment' 
            });
        }

        // Verify if it is manual capture to just cancel it
        const paymentIntent = await stripe.paymentIntents.cancel(payment.stripe_payment_intent_id);

        if (paymentIntent.status === 'canceled') {
            await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment_id);
            res.status(200).json({ success: true, data: paymentIntent, message: 'Payment refunded' });
        } else {
            res.status(400).json({ success: false, data: null, message: 'Failed to cancel payment intent' });
        }
    } catch (error) {
        next(error);
    }
};

// Stripe Webhook Endpoint
exports.handleWebhook = async (req, res) => {
    const rawBody = req.body;
    const signature = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret || endpointSecret === 'your_stripe_webhook_secret') {
        logger.error('STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
    } catch (err) {
        logger.error('Webhook signature verification failed', err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        // Handle the event
        switch (event.type) {
            case 'payment_intent.amount_capturable_updated':
                const intentObj = event.data.object;
                // Funds are put into escrow successfully
                await supabase.from('payments').update({ status: 'requires_capture' }).eq('stripe_payment_intent_id', intentObj.id);
                break;
            case 'payment_intent.succeeded':
                const intentSucceeded = event.data.object;
                // Funds released to freelancer
                await supabase.from('payments').update({ status: 'released' }).eq('stripe_payment_intent_id', intentSucceeded.id);
                break;
            case 'payment_intent.canceled':
                const intentCanceled = event.data.object;
                // Funds refunded to client
                await supabase.from('payments').update({ status: 'refunded' }).eq('stripe_payment_intent_id', intentCanceled.id);
                break;
            case 'payment_intent.payment_failed':
                const intentFailed = event.data.object;
                await supabase.from('payments').update({ status: 'failed' }).eq('stripe_payment_intent_id', intentFailed.id);
                break;
            default:
                logger.log(`Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        logger.error('Webhook handling failed', error);
        res.status(500).send('Webhook handler failed');
    }
};

/**
 * [REAL MODE] Create Razorpay Order for Escrow
 * POST /api/payments/razorpay/create-escrow
 */
exports.createRazorpayEscrowOrder = async (req, res, next) => {
    try {
        const { contract_id, amount } = req.body;
        const clientId = req.user.id;

        // Verify contract ownership
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, client_id, freelancer_id, status')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) return res.status(404).json({ success: false, message: 'Contract not found' });
        if (contract.client_id !== clientId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const options = {
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'INR',
            receipt: `esc_${contract_id.substring(0, 8)}`,
            notes: {
                contract_id,
                client_id: clientId,
                freelancer_id: contract.freelancer_id,
                type: 'escrow_funding'
            }
        };

        const razorpay = getRazorpayClient();
        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key_id: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (err) {
        logger.error('[Escrow] Razorpay Order Error:', err);
        next(err);
    }
};

/**
 * [REAL MODE] Verify Razorpay Escrow and Activate Contract
 * POST /api/payments/razorpay/verify-escrow
 */
exports.verifyRazorpayEscrow = async (req, res, next) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, contract_id, amount } = req.body;
        const clientId = req.user.id;

        // 1. Signature check
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }

        // 2. Atomic Escrow Update
        // Reuse the logic from process_escrow_funding or similar RPC
        const { data, error } = await adminClient.rpc('process_escrow_funding', {
            p_contract_id: contract_id,
            p_milestone_id: null, // Funding whole contract usually
            p_client_id: clientId,
            p_amount: parseFloat(amount),
            p_stripe_pi_id: razorpay_payment_id // Log Razorpay PI in standard field
        });

        if (error) throw error;

        // 3. Log real payment record
        await adminClient.from('payments').insert([{
            contract_id,
            payer_id: clientId,
            payee_id: (await adminClient.from('contracts').select('freelancer_id').eq('id', contract_id).single()).data?.freelancer_id,
            amount: parseFloat(amount),
            status: 'held', // 'held' in escrow
            payment_gateway: 'razorpay',
            gateway_payment_id: razorpay_payment_id,
            description: 'Funds held in Razorpay escrow'
        }]);

        res.status(200).json({ success: true, message: 'Escrow funded successfully' });
    } catch (err) {
        logger.error('[Escrow] Razorpay Verification Error:', err);
        next(err);
    }
};

/**
 * Get payment history for the current user
 * GET /api/payments/history
 */
exports.getMyPayments = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Fetch payments where user is either payer or payee
        // Join with contracts and jobs to get context
        const { data, error } = await supabase
            .from('payments')
            .select(`
                *,
                contracts (
                    id,
                    title,
                    jobs (
                        id,
                        title
                    )
                )
            `)
            .or(`payer_id.eq.${userId},payee_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: data || [],
            message: 'Payment history retrieved successfully'
        });
    } catch (error) {
        logger.error('[Payment History] Error:', error);
        next(error);
    }
};

