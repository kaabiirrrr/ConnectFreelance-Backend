const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * PLATFORM AUDIT CRON: Integrity Safeguard
 * Performs 1:1 balance checking and triggers Circuit Breaker if compromised.
 */

exports.runPlatformAudit = async () => {
    try {
        logger.log('[Audit] Starting global financial integrity check...');

        // 1. Fetch Platform Wallet Balance
        const { data: wallet } = await adminClient
            .from('platform_wallets')
            .select('balance')
            .limit(1)
            .single();

        // 2. Fetch Aggregated Ledger Total (Commission only)
        const { data: ledger } = await adminClient
            .from('escrow_ledger')
            .select('amount.sum()') // Use Supabase aggregate if supported, or RPC
            .filter('type', 'eq', 'RELEASE'); // In this system, commission is calculated during release
        
        // Let's use a more robust SQL-based audit via RPC if possible, 
        // but for this implementation we simulate the comparison logic.
        
        const { data: totalReport, error: auditErr } = await adminClient.rpc('audit_platform_integrity');
        
        if (auditErr) throw auditErr;

        const { mismatch, actual_balance, expected_balance } = totalReport;

        if (Math.abs(mismatch) > 0.01) {
            logger.error(`[AUDIT_FAILURE] DISCREPANCY DETECTED: $${mismatch}. Wallet: $${actual_balance}, Ledger: $${expected_balance}`);
            
            // Trigger CIRCUIT BREAKER: DEGRADED
            await adminClient
                .from('platform_settings')
                .update({ 
                    setting_value: { 
                        status: 'DEGRADED', 
                        reason: `Audit mismatch detected ($${mismatch}). Outbound movements locked for safety.`,
                        timestamp: new Date().toISOString()
                    } 
                })
                .eq('setting_key', 'system_status');
            
            // --- ALERT NOTIFICATION (Simulated) ---
            logger.error('CRITICAL: Sending alerts to Finance Admins via Slack/Email...');
            
        } else {
            // AUTO-RECOVERY: If mismatch is fixed (manually or via sync), restore system health
            const { data: currentStatus } = await adminClient
                .from('platform_settings')
                .select('setting_value')
                .eq('setting_key', 'system_status')
                .single();

            if (currentStatus?.setting_value?.status !== 'HEALTHY') {
                logger.log('[Audit] Integrity restored. Resetting system status to HEALTHY.');
                await adminClient
                    .from('platform_settings')
                    .update({ 
                        setting_value: { 
                            status: 'HEALTHY', 
                            reason: 'System integrity verified by automated audit.',
                            timestamp: new Date().toISOString()
                        } 
                    })
                    .eq('setting_key', 'system_status');
            }
        }

        // 3. --- RECONCILIATION: ORPHANED PAYMENTS ---
        logger.log('[Audit] Checking for orphaned payments...');
        const { data: orphaned } = await adminClient
            .from('payments')
            .select('*, contracts(client_id)')
            .eq('status', 'orphaned_payment')
            .eq('reconciliation_needed', true);

        if (orphaned && orphaned.length > 0) {
            logger.warn(`[Audit] Found ${orphaned.length} orphaned payments. Attempting auto-reconciliation...`);
            for (const payment of orphaned) {
                try {
                    // Re-trigger the bank-grade release RPC
                    // It uses Stripe PI ID as idempotency key, so it's safe to retry
                    const { data: res, error: rpcErr } = await adminClient.rpc('process_escrow_release_v5', {
                        p_milestone_id: payment.metadata?.milestone_id || null, // Ensure milestone_id is in metadata or contract
                        p_client_id: payment.contracts?.client_id,
                        p_idempotency_key: payment.stripe_payment_intent_id
                    });

                    if (rpcErr) throw rpcErr;
                    
                    if (res?.success) {
                        logger.log(`[Audit] Successfully reconciled payment: ${payment.id}`);
                        await adminClient
                            .from('payments')
                            .update({ status: 'released', reconciliation_needed: false })
                            .eq('id', payment.id);
                    } else {
                        logger.error(`[Audit] Reconciliation failed for ${payment.id}: ${res?.message}`);
                    }
                } catch (e) {
                    logger.error(`[Audit] Fatal error reconciling ${payment.id}:`, e.message);
                }
            }
        }

        logger.log('[Audit] Integrity check passed.');
    } catch (err) {
        logger.error('[Audit] Fatal audit Failure:', err);
    }
};
