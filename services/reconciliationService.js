const stripe = require('../stripe/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * RECONCILIATION SERVICE: Self-Healing Financial Redundancy
 * Syncs Stripe external state with internal database ledger.
 */

exports.syncWithStripe = async () => {
    try {
        logger.log('[Reconciliation] Starting Stripe-to-Ledger sync...');

        // 1. Fetch Sync Cursor
        const { data: syncData } = await adminClient
            .from('platform_settings')
            .select('setting_value')
            .eq('setting_key', 'last_stripe_sync_at')
            .single();

        const lastSyncISO = syncData?.setting_value || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const lastSyncUnix = Math.floor(new Date(lastSyncISO).getTime() / 1000);

        // 2. Poll for "Succeeded" events since last sync
        const events = await stripe.events.list({
            type: 'payment_intent.succeeded',
            created: { gte: lastSyncUnix },
            limit: 100
        });

        logger.log(`[Reconciliation] Found ${events.data.length} stripe events since ${lastSyncISO}`);

        let fixedCount = 0;
        for (const event of events.data) {
            const intent = event.data.object;
            const piId = intent.id;

            // 3. Check Ledger Presence (Atomic Idempotency)
            const { data: ledgerEntry } = await adminClient
                .from('escrow_ledger')
                .select('id')
                .eq('stripe_payment_intent_id', piId)
                .maybeSingle();

            if (!ledgerEntry) {
                logger.warn(`[Reconciliation] MISSING LEDGER ENTRY for Stripe PI: ${piId}. Auto-repairing...`);
                
                // 4. Trigger Atomic Repair RPC
                // We use metadata to re-construct the context
                const { contract_id, milestone_id, client_id, freelancer_id } = intent.metadata;
                
                if (!contract_id || !client_id) {
                    logger.error(`[Reconciliation] FAILED repair for ${piId}: Missing metadata.`);
                    continue;
                }

                const { error: rpcErr } = await adminClient.rpc('reconcile_ledger_entry', {
                    p_idempotency_key: piId, // Use PI ID as idempotency fallback
                    p_operation_type: 'RELEASE',
                    p_sender_id: client_id,
                    p_receiver_id: freelancer_id,
                    p_amount: intent.amount / 100,
                    p_contract_id: contract_id,
                    p_milestone_id: milestone_id || null,
                    p_metadata: { source: 'reconciliation_service', event_id: event.id }
                });

                if (rpcErr) {
                    logger.error(`[Reconciliation] RPC Repair failed for ${piId}:`, rpcErr);
                } else {
                    fixedCount++;
                }
            }
        }

        // 5. Update Cursor (DB NOW)
        await adminClient
            .from('platform_settings')
            .update({ 
                setting_value: new Date().toISOString(),
                updated_at: new Date().toISOString() 
            })
            .eq('setting_key', 'last_stripe_sync_at');

        logger.log(`[Reconciliation] Sync complete. Fixed ${fixedCount} orphaned transactions.`);

    } catch (err) {
        logger.error('[Reconciliation] Fatal sync failure:', err);
    }
};
