const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

exports.getAllDisputes = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('disputes')
            .select(`
                *,
                raiser:users!raised_by(email, profiles(name)),
                contract:contracts(id)
            `, { count: 'exact' });

        if (status) query = query.eq('status', status.toUpperCase());

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

exports.resolveDispute = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { resolution, action } = req.body; // action: 'REFUND_CLIENT', 'RELEASE_FREELANCER', 'SPLIT'

        // 1. Fetch dispute and contract info
        const { data: dispute, error: disputeError } = await supabase
            .from('disputes')
            .select('*, contract:contracts(id, status)')
            .eq('id', id)
            .single();

        if (disputeError) throw disputeError;

        // 2. Financial Resolution logic
        let paymentUpdate = null;
        if (action === 'REFUND_CLIENT' || action === 'RELEASE_FREELANCER') {
            // Find the active escrow payment for this contract
            const { data: payment, error: paymentFetchError } = await supabase
                .from('payments')
                .select('*')
                .eq('contract_id', dispute.contract_id)
                .eq('status', 'requires_capture')
                .single();

            if (paymentFetchError) {
                logger.warn('No capture-ready payment found for contract', { contractId: dispute.contract_id });
            } else if (payment && payment.stripe_payment_intent_id) {
                try {
                    if (action === 'REFUND_CLIENT') {
                        // Cancel the intent
                        await stripe.paymentIntents.cancel(payment.stripe_payment_intent_id);
                        paymentUpdate = { status: 'refunded', id: payment.id };
                    } else if (action === 'RELEASE_FREELANCER') {
                        // Capture the intent
                        await stripe.paymentIntents.capture(payment.stripe_payment_intent_id);
                        paymentUpdate = { status: 'released', id: payment.id };
                    }
                } catch (stripeError) {
                    logger.error('Stripe error in dispute resolution', stripeError);
                    return res.status(400).json({ success: false, message: `Stripe error: ${stripeError.message}` });
                }
            }
        }

        // 3. Update dispute status
        const { error: updateError } = await supabase
            .from('disputes')
            .update({ status: 'RESOLVED', resolution, updated_at: new Date() })
            .eq('id', id);

        if (updateError) throw updateError;

        // 4. Update payment record if applicable
        if (paymentUpdate) {
            await supabase
                .from('payments')
                .update({ status: paymentUpdate.status, updated_at: new Date() })
                .eq('id', paymentUpdate.id);
        }

        // 5. Update contract status to COMPLETED after resolution
        await supabase
            .from('contracts')
            .update({ status: 'COMPLETED', updated_at: new Date() })
            .eq('id', dispute.contract_id);

        await logAction(req.user.id, 'DISPUTE_RESOLVE', id, `Resolved dispute ID: ${id}. Resolution: ${resolution}, Action: ${action}`);

        res.status(200).json({ success: true, message: `Dispute resolved with action: ${action}` });
    } catch (error) {
        next(error);
    }
};
