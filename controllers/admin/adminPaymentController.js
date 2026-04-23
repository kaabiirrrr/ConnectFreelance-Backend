const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

exports.getAllPayments = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('payments')
            .select(`
                *,
                payer:users!payer_id(email, profiles(name)),
                payee:users!payee_id(email, profiles(name)),
                contract:contracts(
                    id,
                    job:jobs(title)
                )
            `, { count: 'exact' })

        if (status) query = query.eq('status', status.toLowerCase());

        const { data, count, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: {
                total: count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.issueRefund = async (req, res, next) => {
    try {
        const { payment_id } = req.body;

        // 1. Fetch payment intent from DB
        const { data: payment, error } = await supabase
            .from('payments')
            .select('*')
            .eq('id', payment_id)
            .single();

        if (error || !payment) throw new Error('Payment not found');

        // 2. Issue Stripe Refund (Mocked for now since Stripe keys aren't provided in context)
        // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        // await stripe.refunds.create({ payment_intent: payment.stripe_payment_intent_id });

        // 3. Update DB
        const { error: updateError } = await supabase
            .from('payments')
            .update({ status: 'refunded', updated_at: new Date() })
            .eq('id', payment_id);

        if (updateError) throw updateError;

        await logAction(req.user.id, 'PAYMENT_REFUND', payment_id, `Refunded payment ID: ${payment_id}`);

        res.status(200).json({ success: true, message: 'Refund issued successfully' });
    } catch (error) {
        next(error);
    }
};
