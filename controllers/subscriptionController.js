const stripe = require('../stripe/client');
const supabase = require('../supabase/client');

// Ideally, these come from your DB or env properly mapped
const PLAN_PRICE_IDS = {
    'BASIC': 'price_basic_id_placeholder',
    'PLUS': 'price_plus_id_placeholder',
    'BUSINESS': 'price_business_id_placeholder'
};

exports.createSubscription = async (req, res, next) => {
    try {
        const { plan, payment_method_id } = req.body;
        const userId = req.user.id;
        const email = req.user.email;

        if (!PLAN_PRICE_IDS[plan]) {
            return res.status(400).json({ success: false, data: null, message: 'Invalid plan selected' });
        }

        // Check if user already has a Stripe customer ID in our DB
        let { data: existingSub } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', userId)
            .single();

        let stripeCustomerId;

        if (existingSub && existingSub.stripe_customer_id) {
            stripeCustomerId = existingSub.stripe_customer_id;
        } else {
            // Create Stripe customer
            const customer = await stripe.customers.create({
                email,
                payment_method: payment_method_id,
                invoice_settings: {
                    default_payment_method: payment_method_id,
                },
            });
            stripeCustomerId = customer.id;
        }

        // Create the subscription
        const subscription = await stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [{ price: PLAN_PRICE_IDS[plan] }],
            expand: ['latest_invoice.payment_intent'],
        });

        // Save to DB
        const { data, error } = await supabase
            .from('subscriptions')
            .upsert({
                user_id: userId,
                stripe_subscription_id: subscription.id,
                stripe_customer_id: stripeCustomerId,
                tier: plan,
                status: subscription.status,
                current_period_end: new Date(subscription.current_period_end * 1000)
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            data: {
                subscriptionId: subscription.id,
                clientSecret: subscription.latest_invoice.payment_intent?.client_secret,
                status: subscription.status
            },
            message: 'Subscription created'
        });

    } catch (error) {
        next(error);
    }
};

exports.getSubscriptionStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116 is not found

        if (!data) {
            return res.status(200).json({ success: true, data: { status: 'none' }, message: 'No active subscription' });
        }

        res.status(200).json({ success: true, data, message: 'Subscription status retrieved' });
    } catch (error) {
        next(error);
    }
};

exports.cancelSubscription = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data: sub, error: dbError } = await supabase
            .from('subscriptions')
            .select('stripe_subscription_id')
            .eq('user_id', userId)
            .single();

        if (dbError || !sub) {
            return res.status(404).json({ success: false, data: null, message: 'Subscription not found' });
        }

        const canceledSub = await stripe.subscriptions.cancel(sub.stripe_subscription_id);

        const { data, error } = await supabase
            .from('subscriptions')
            .update({ status: canceledSub.status })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Subscription canceled successfully' });
    } catch (error) {
        next(error);
    }
};
