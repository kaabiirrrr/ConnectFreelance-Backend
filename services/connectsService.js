const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * CONNECTS ECONOMY SERVICE (V2 MASTER)
 * Standardized Fintech logic with Atomic operations and accumulation top-ups.
 */
class ConnectsService {
    /**
     * Fetch global connect settings
     */
    async getSettings() {
        try {
            const { data, error } = await adminClient
                .from('connect_settings')
                .select('*')
                .eq('is_connect_system_enabled', true)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            return data || { is_connect_system_enabled: false, job_post_cost: 6, proposal_submit_cost: 2, proposal_accept_cost: 6 };
        } catch (err) {
            logger.error('[ConnectsService] Failed to fetch settings', err);
            return { is_connect_system_enabled: false, job_post_cost: 6, proposal_submit_cost: 2, proposal_accept_cost: 6 };
        }
    }

    /**
     * TOP-UP SYSTEM (Monthly logic)
     * Aliased to applyMonthlyTopup for controller compatibility.
     */
    async applyMonthlyTopup(userId, planType = 'FREE') {
        return this.handleMonthlyReset(userId, planType);
    }

    async handleMonthlyReset(userId, planType = 'FREE') {
        try {
            // 1. Fetch current wallet directly
            const { data: wallet, error: walletError } = await adminClient
                .from('user_connects')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            if (walletError) throw walletError;

            if (!wallet) {
                // Initialize wallet if missing with default free units
                logger.log(`[ConnectsService] Initializing first wallet for User ${userId}`);
                await adminClient.from('user_connects').insert([{ user_id: userId, balance: 20 }]);
                return;
            }

            const now = new Date();
            const lastTopup = wallet.last_topup_date ? new Date(wallet.last_topup_date) : new Date(0);
            const daysSinceLast = Math.floor((now - lastTopup) / (1000 * 60 * 60 * 24));

            // 2. Check if 30 days have passed
            if (daysSinceLast >= 30) {
                // Map plan types to connect amounts
                const topupMap = {
                    'FREE': 20,
                    'PRO': 100,
                    'ELITE': 300
                };
                
                const topupAmount = topupMap[planType] || 20;

                logger.info(`[Top-up] Triggering +${topupAmount} connects for User ${userId} (Plan: ${planType})`);

                // 3. ATOMIC CREDIT
                await this.creditConnects(
                    userId,
                    topupAmount,
                    'monthly_free', // Action matches migration check
                    null,
                    {
                        source: 'monthly_topup',
                        plan: planType,
                        days_since_last: daysSinceLast
                    }
                );

                // 4. Update last_topup_date (handled by RPC but good to redundant check)
                await adminClient
                    .from('user_connects')
                    .update({ last_topup_date: now.toISOString() })
                    .eq('user_id', userId);
            }
        } catch (err) {
            logger.error('[ConnectsService] Monthly reset logic failed', err);
        }
    }

    /**
     * ATOMIC DEBIT (Safe for Job Post, Proposals, etc.)
     */
    async handleConnectDeduction(userId, actionSource, metadata = {}) {
        try {
            const settings = await this.getSettings();

            if (!settings.is_connect_system_enabled) {
                logger.debug(`[ConnectsService] Free mode enabled. Skipping ${actionSource}`);
                return true;
            }

            const costMap = {
                job_post: settings.job_post_cost,
                proposal_submit: settings.proposal_submit_cost,
                proposal_accept: settings.proposal_accept_cost
            };

            const cost = costMap[actionSource] || 0;
            if (cost <= 0) return true;

            const actionLabels = {
                job_post: 'Job Posted',
                proposal_submit: 'Proposal Submitted',
                proposal_accept: 'Freelancer Hired',
                membership_payment: 'Membership Purchase',
            };

            // RPC call to debit_connects_atomic
            const actionLabel = actionLabels[actionSource] || 'Deduction';
            const { data: newBalance, error } = await adminClient.rpc('debit_connects_atomic', {
                p_user_id: userId,
                p_amount: cost,
                p_action_source: actionSource,
                p_description: metadata.job_title
                    ? `${actionLabel} · ${metadata.job_title}`
                    : (metadata.description || actionLabel),
                p_reference_id: metadata.job_id || null,
                p_metadata: { ...metadata, source: actionSource }
            });

            if (error) {
                if (error.message.includes('INSUFFICIENT_CONNECTS')) throw new Error('INSUFFICIENT_CONNECTS');
                throw error;
            }

            return newBalance;
        } catch (err) {
            logger.error(`[ConnectsService] Debit failed: ${actionSource}`, err.message);
            throw err;
        }
    }

    /**
     * DYNAMIC CONNECT COST — AI Match Discount System
     * High-match jobs cost fewer connects to apply (rewards quality applicants).
     * Low-match jobs cost more (soft spam tax).
     */
    async getJobApplicationCost(jobId, freelancerId) {
        try {
            const settings = await this.getSettings();
            const baseConnects = settings.proposal_submit_cost || 2;

            if (!settings.is_connect_system_enabled) return baseConnects;

            // Look up pre-computed match score
            const adminClient = require('../supabase/adminClient');
            const { data: rec } = await adminClient
                .from('job_recommendations')
                .select('match_score')
                .eq('job_id', jobId)
                .eq('freelancer_id', freelancerId)
                .maybeSingle();

            const score = rec?.match_score ?? null;

            // No rec yet = neutral cost
            if (score === null) return baseConnects;

            // Apply discount / premium tiers
            if (score >= 85) return Math.max(1, baseConnects - 4);   // ~40% discount — Excellent Match
            if (score >= 70) return Math.max(1, baseConnects - 2);   // ~20% discount — Good Match
            if (score < 55)  return baseConnects + 2;                 // +20% penalty  — Poor Fit (spam tax)
            return baseConnects;                                       // 55–69: no change
        } catch (err) {
            logger.warn('[ConnectsService] getJobApplicationCost fallback to base cost', err.message);
            return (await this.getSettings()).proposal_submit_cost || 2;
        }
    }

    /**
     * ATOMIC CREDIT (Safe for Payments, Bonuses, Refunds)
     */
    async creditConnects(userId, amount, actionSource, referenceId = null, metadata = {}) {
        try {
            const { data: newBalance, error } = await adminClient.rpc('credit_connects_atomic', {
                p_user_id: userId,
                p_amount: amount,
                p_action_source: actionSource,
                p_description: metadata.description || `Connect credit from ${actionSource}`,
                p_reference_id: referenceId,
                p_metadata: { ...metadata, source: actionSource }
            });

            if (error) throw error;
            return newBalance;
        } catch (err) {
            logger.error(`[ConnectsService] Credit failed: ${actionSource}`, err);
            throw err;
        }
    }
}

module.exports = new ConnectsService();
