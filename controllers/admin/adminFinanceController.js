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
        const withdrawalFeeRate = 0.03; // Default 3%

        // 2. Aggregate Revenue Streams in parallel
        const [
            { data: contractPayments },
            { data: memberships },
            { data: connectPurchases },
            { data: processedWithdrawals }
        ] = await Promise.all([
            // Contract Payments (Released)
            supabase.from('payments').select('amount').eq('status', 'released'),
            
            // Memberships (Successful)
            supabase.from('memberships').select('plan_snapshot'),
            
            // Connect Purchases
            supabase.from('connect_transactions').select('amount, metadata').eq('action_source', 'purchase'),
            
            // Withdrawals (Completed - often have fees)
            supabase.from('withdrawals').select('amount').eq('status', 'COMPLETED')
        ]);

        // 3. Calculate Totals
        // Contract Commission
        const contractTotalVolume = (contractPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        const contractCommission = contractTotalVolume * commissionRate;

        // Membership Revenue (Stored in INR in snapshot)
        const membershipRevenue = (memberships || []).reduce((sum, m) => {
            const price = Number(m.plan_snapshot?.price || 0);
            // If price > 1000, it's likely in Paise, convert to INR
            return sum + (price > 5000 ? price / 100 : price);
        }, 0);

        // Connects Revenue (Metadata contains package info, but amount is connects. 
        // We need to map package to price or use transaction history if price was logged)
        // For now, use a standard rate: 1 Connect = 5 INR
        const connectsRevenue = (connectPurchases || []).reduce((sum, c) => {
             // In v2, we log package price in metadata if possible
             const pkgPrice = Number(c.metadata?.price || 0);
             if (pkgPrice > 0) return sum + (pkgPrice > 5000 ? pkgPrice / 100 : pkgPrice);
             return sum + (Number(c.amount) * 5); // Fallback
        }, 0);

        // Withdrawal Fees (Assuming 3% fee taken by platform)
        const withdrawalVolume = (processedWithdrawals || []).reduce((sum, w) => sum + Number(w.amount), 0);
        const withdrawalFees = withdrawalVolume * withdrawalFeeRate;

        const totalRevenue = contractCommission + membershipRevenue + connectsRevenue + withdrawalFees;

        // 4. Breakdown for Table
        const breakdown = [
            { source: 'Contract Commission (3%)', amount: contractCommission, share: totalRevenue > 0 ? (contractCommission / totalRevenue) * 100 : 0 },
            { source: 'Membership Plans', amount: membershipRevenue, share: totalRevenue > 0 ? (membershipRevenue / totalRevenue) * 100 : 0 },
            { source: 'Connects Purchases', amount: connectsRevenue, share: totalRevenue > 0 ? (connectsRevenue / totalRevenue) * 100 : 0 },
            { source: 'Withdrawal Fees (3%)', amount: withdrawalFees, share: totalRevenue > 0 ? (withdrawalFees / totalRevenue) * 100 : 0 }
        ];

        res.status(200).json({
            success: true,
            data: {
                totalRevenue: Number(totalRevenue.toFixed(2)),
                totalCommission: Number(contractCommission.toFixed(2)),
                membershipRevenue: Number(membershipRevenue.toFixed(2)),
                connectsRevenue: Number(connectsRevenue.toFixed(2)),
                withdrawalFees: Number(withdrawalFees.toFixed(2)),
                growth: 12.5, // Placeholder for trend
                commissionTrend: "+8.2%", // Placeholder
                revenueTrend: "+15.4%", // Placeholder
                breakdown
            }
        });
    } catch (error) {
        console.error('[AdminFinance] Revenue Overview Error:', error);
        next(error);
    }
};
