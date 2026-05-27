const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');

/**
 * Get all withdrawal requests
 */
exports.getWithdrawalRequests = async (req, res, next) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;

        let query = supabase
            .from('withdrawals')
            .select('*', { count: 'exact' });

        if (status) query = query.eq('status', status);

        const { data, count, error } = await query
            .order('requested_at', { ascending: false })
            .range(offset, parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data,
            pagination: { total: count, limit, offset }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Approve or Reject withdrawal
 */
exports.processWithdrawal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // APPROVED or REJECTED

        const { error } = await supabase
            .from('withdrawals')
            .update({
                status,
                processed_at: new Date(),
                processed_by: req.user.id
            })
            .eq('id', id);

        if (error) throw error;

        await logAction(
            req.user.id,
            'WITHDRAWAL_PROCESS',
            id,
            `Withdrawal ${id} status set to ${status}`
        );

        res.status(200).json({
            success: true,
            message: `Withdrawal ${status.toLowerCase()} successfully`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update platform commission
 */
exports.updateCommission = async (req, res, next) => {
    try {
        const { percentage } = req.body;

        if (percentage < 0 || percentage > 100) {
            return res.status(400).json({ success: false, message: 'Invalid percentage' });
        }

        const { error } = await supabase
            .from('platform_settings')
            .upsert({
                setting_key: 'commission_percentage',
                setting_value: percentage.toString(),
                updated_at: new Date()
            }, { onConflict: 'setting_key' });

        if (error) throw error;

        await logAction(
            req.user.id,
            'SETTINGS_UPDATE',
            'COMMISSION',
            `Platform commission updated to ${percentage}%`
        );

        res.status(200).json({
            success: true,
            message: `Platform commission updated to ${percentage}%`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current platform settings
 */
exports.getPlatformSettings = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('*');

        if (error) throw error;

        const settings = {};
        data.forEach(s => settings[s.setting_key] = s.setting_value);

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get overall platform revenue metrics
 */
exports.getRevenueOverview = async (req, res, next) => {
    try {
        // 1. Fetch Platform Settings (Commission)
        const { data: settings } = await supabase
            .from('platform_settings')
            .select('*');
        
        const settingsMap = {};
        settings?.forEach(s => settingsMap[s.setting_key] = s.setting_value);
        
        const commissionRate = parseFloat(settingsMap['commission_percentage'] || '3') / 100;
        const withdrawalFeeRate = 0.03;

        // 2. Aggregate Revenue Streams in parallel
        const [
            { data: contractPayments },
            { data: memberships },
            { data: connectPurchases },
            { data: processedWithdrawals }
        ] = await Promise.all([
            // Contract Payments — released OR succeeded
            supabase
                .from('payments')
                .select('amount')
                .in('status', ['released', 'succeeded']),
            
            // Memberships — only ACTIVE ones with a price in plan_snapshot
            supabase
                .from('memberships')
                .select('plan_snapshot')
                .eq('status', 'ACTIVE'),
            
            // Connect Purchases — action_source = 'purchase', type = 'CREDIT'
            supabase
                .from('connect_transactions')
                .select('amount, metadata')
                .eq('action_source', 'purchase')
                .eq('type', 'CREDIT'),
            
            // Withdrawals — COMPLETED status
            supabase
                .from('withdrawals')
                .select('amount')
                .eq('status', 'COMPLETED')
        ]);

        // 3. Calculate Totals

        // Contract Commission: sum of released payment amounts × commission rate
        const contractTotalVolume = (contractPayments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const contractCommission = contractTotalVolume * commissionRate;

        // Membership Revenue: plan_snapshot.price is stored in paise (Razorpay), divide by 100
        const membershipRevenue = (memberships || []).reduce((sum, m) => {
            const rawPrice = Number(m.plan_snapshot?.price || 0);
            // Razorpay stores in paise — values > 100 are paise, convert to INR
            const priceINR = rawPrice > 100 ? rawPrice / 100 : rawPrice;
            return sum + priceINR;
        }, 0);

        // Connects Revenue: use metadata.price_inr if available, else metadata.price (paise → INR)
        const connectsRevenue = (connectPurchases || []).reduce((sum, c) => {
            const meta = c.metadata || {};
            if (meta.price_inr) return sum + Number(meta.price_inr);
            if (meta.price) {
                const p = Number(meta.price);
                return sum + (p > 500 ? p / 100 : p); // paise guard
            }
            if (meta.amount_inr) return sum + Number(meta.amount_inr);
            return sum; // skip if no price info — don't fabricate
        }, 0);

        // Withdrawal Fees
        const withdrawalVolume = (processedWithdrawals || []).reduce((sum, w) => sum + Number(w.amount || 0), 0);
        const withdrawalFees = withdrawalVolume * withdrawalFeeRate;

        const totalRevenue = contractCommission + membershipRevenue + connectsRevenue + withdrawalFees;

        // 4. Breakdown
        const breakdown = [
            { source: 'Contract Commission (3%)', amount: Number(contractCommission.toFixed(2)), share: totalRevenue > 0 ? (contractCommission / totalRevenue) * 100 : 0 },
            { source: 'Membership Plans', amount: Number(membershipRevenue.toFixed(2)), share: totalRevenue > 0 ? (membershipRevenue / totalRevenue) * 100 : 0 },
            { source: 'Connects Purchases', amount: Number(connectsRevenue.toFixed(2)), share: totalRevenue > 0 ? (connectsRevenue / totalRevenue) * 100 : 0 },
            { source: 'Withdrawal Fees (3%)', amount: Number(withdrawalFees.toFixed(2)), share: totalRevenue > 0 ? (withdrawalFees / totalRevenue) * 100 : 0 }
        ];

        res.status(200).json({
            success: true,
            data: {
                totalRevenue: Number(totalRevenue.toFixed(2)),
                contract_commission: Number(contractCommission.toFixed(2)),
                total_commission: Number(contractCommission.toFixed(2)),
                membership_revenue: Number(membershipRevenue.toFixed(2)),
                connects_revenue: Number(connectsRevenue.toFixed(2)),
                withdrawal_fees: Number(withdrawalFees.toFixed(2)),
                breakdown,
                // Volume stats for context
                contractVolume: Number(contractTotalVolume.toFixed(2)),
                withdrawalVolume: Number(withdrawalVolume.toFixed(2)),
            }
        });
    } catch (error) {
        console.error('[AdminFinance] Revenue Overview Error:', error);
        next(error);
    }
};
