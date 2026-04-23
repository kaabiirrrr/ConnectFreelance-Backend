const crypto = require('crypto');
const supabase = require('../supabase/client');
const logger = require('../utils/logger');
const connectsService = require('../services/connectsService');

/**
 * PRODUCTION-READY RAZORPAY WEBHOOK HANDLER
 * Source of Truth for Membership Activations
 */
exports.handleWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    try {
        // 1. SIGNATURE VERIFICATION (STRICT)
        // req.body is a Buffer due to express.raw()
        const rawBody = req.body.toString();
        
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(rawBody);
        const expectedSignature = shasum.digest('hex');

        if (expectedSignature !== signature) {
            logger.warn('[Webhook] Invalid signature received');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const body = JSON.parse(rawBody);
        const event = body.event;
        const payload = body.payload;

        logger.info(`[Webhook] Received Razorpay Event: ${event}`);

        // 2. HANDLE SUCCESSFUL PAYMENT EVENTS
        if (event === 'payment.captured' || event === 'order.paid') {
            const payment = payload.payment?.entity;
            const orderId = payment?.order_id || payload.order?.entity?.id;
            const userId = payment?.notes?.user_id;
            const planId = payment?.notes?.plan_id;

            if (!orderId || !userId || !planId) {
                logger.error('[Webhook] Missing critical metadata (orderId/userId/planId)', { orderId, userId, planId });
                return res.status(400).json({ success: false, message: 'Missing metadata' });
            }

            // 3. IDEMPOTENCY CHECK (Is this already processed?)
            const { data: existing } = await supabase
                .from('memberships')
                .select('id')
                .eq('order_id', orderId)
                .maybeSingle();

            if (existing) {
                logger.debug(`[Webhook] Order ${orderId} already processed. Skipping.`);
                return res.status(200).json({ status: 'ok', detail: 'Already processed' });
            }

            // 4. FETCH PLAN DETAILS (Dynamic)
            const { data: plan, error: planErr } = await supabase
                .from('membership_plans')
                .select('*')
                .eq('id', planId)
                .single();

            if (planErr || !plan) {
                logger.error('[Webhook] Plan not found for activation', { planId });
                return res.status(404).json({ success: false, message: 'Plan not found' });
            }

            // 5. ATOMIC ACTIVATION
            logger.info(`[Webhook] Activating ${plan.name} for User ${userId}`);
            
            // Create membership record
            const { error: insertErr } = await supabase
                .from('memberships')
                .insert([{
                    user_id: userId,
                    plan_id: planId,
                    status: 'ACTIVE',
                    payment_id: payment.id,
                    order_id: orderId,
                    start_date: new Date().toISOString(),
                    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    plan_snapshot: {
                        name: plan.name,
                        price: plan.price,
                        connects: plan.connects_per_month,
                        service_fee: plan.service_fee
                    }
                }]);

            if (insertErr) {
                logger.error('[Webhook] Membership insert failed', insertErr);
                throw insertErr;
            }

            // 6. CREDIT BONUS CONNECTS (Top-up logic)
            if (plan.connects_per_month > 0) {
                await connectsService.creditConnects(
                    userId,
                    plan.connects_per_month,
                    'membership_payment',
                    orderId,
                    {
                        source: 'membership_payment',
                        plan: plan.name,
                        event_type: event
                    }
                );
            }

            // 7. SYNC TO PROFILE
            await supabase
                .from('profiles')
                .update({ 
                    membership_type: plan.name,
                    is_pro: plan.name !== 'FREE'
                })
                .eq('user_id', userId);

            logger.info(`[Webhook] Successfully activated plan for User ${userId}`);
        }

        res.status(200).json({ status: 'ok' });

    } catch (error) {
        logger.error('[Webhook] Process Error:', error);
        res.status(500).json({ success: false, message: 'Internal processor error' });
    }
};
