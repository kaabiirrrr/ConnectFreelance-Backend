const adminClient = require('../supabase/adminClient');
const stripe = require('../stripe/client');

// GET /api/billing/methods
exports.getBillingMethods = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('billing_methods')
            .select('*')
            .eq('user_id', userId)
            .order('is_default', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// POST /api/billing/setup-intent — get Stripe SetupIntent to add a card
exports.createSetupIntent = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const email = req.user.email;

        // Get or create Stripe customer
        let { data: existing } = await adminClient
            .from('billing_methods')
            .select('stripe_customer_id')
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle();

        let customerId = existing?.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ email, metadata: { user_id: userId } });
            customerId = customer.id;
        }

        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            payment_method_types: ['card'],
            metadata: { user_id: userId }
        });

        res.status(200).json({
            success: true,
            data: { client_secret: setupIntent.client_secret, customer_id: customerId }
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/billing/methods — save card after Stripe confirms setup
exports.saveBillingMethod = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { payment_method_id, customer_id, set_default = true } = req.body;

        if (!payment_method_id || !customer_id) {
            return res.status(400).json({ success: false, message: 'payment_method_id and customer_id required' });
        }

        // Fetch card details from Stripe
        const pm = await stripe.paymentMethods.retrieve(payment_method_id);
        const card = pm.card || {};

        if (set_default) {
            await adminClient.from('billing_methods').update({ is_default: false }).eq('user_id', userId);
        }

        const { data, error } = await adminClient
            .from('billing_methods')
            .insert([{
                user_id: userId,
                stripe_payment_method_id: payment_method_id,
                stripe_customer_id: customer_id,
                type: pm.type || 'card',
                brand: card.brand || null,
                last4: card.last4 || null,
                exp_month: card.exp_month || null,
                exp_year: card.exp_year || null,
                is_default: set_default
            }])
            .select()
            .single();

        if (error) throw error;

        // Update profile is_email_verified flag if not set (adding a billing method counts as verification)
        await adminClient.from('profiles').update({ is_email_verified: true }).eq('user_id', userId);


        res.status(201).json({ success: true, data, message: 'Billing method saved' });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/billing/methods/:id
exports.deleteBillingMethod = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const { data: bm } = await adminClient
            .from('billing_methods')
            .select('stripe_payment_method_id, user_id')
            .eq('user_id', id)
            .maybeSingle();

        if (!bm || bm.user_id !== userId) {
            return res.status(404).json({ success: false, message: 'Billing method not found' });
        }

        await stripe.paymentMethods.detach(bm.stripe_payment_method_id).catch(() => {});
        await adminClient.from('billing_methods').delete().eq('id', id);

        res.status(200).json({ success: true, message: 'Billing method removed' });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/billing/methods/:id/default
exports.setDefaultBillingMethod = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        await adminClient.from('billing_methods').update({ is_default: false }).eq('user_id', userId);
        const { data, error } = await adminClient
            .from('billing_methods')
            .update({ is_default: true })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
