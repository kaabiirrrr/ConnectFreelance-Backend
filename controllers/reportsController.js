const adminClient = require('../supabase/adminClient');

// Helper: get date N days ago
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
}

// Helper: get Monday of current week
function currentWeekStart() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

// ─── WEEKLY FINANCIAL SUMMARY ─────────────────────────────────────────────────
// GET /api/reports/weekly-summary?from=&to=
exports.getWeeklySummary = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const from = req.query.from || daysAgo(28); // default last 4 weeks
        const to = req.query.to || new Date().toISOString().split('T')[0];

        const isClient = role === 'CLIENT';
        const userField = isClient ? 'payer_id' : 'payee_id';

        const { data: payments, error } = await adminClient
            .from('payments')
            .select('amount, status, created_at, description, contract_id, contracts(title)')
            .eq(userField, userId)
            .gte('created_at', from)
            .lte('created_at', to + 'T23:59:59Z')
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Group by week
        const weeks = {};
        for (const p of payments || []) {
            const date = new Date(p.created_at);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const weekStart = new Date(new Date(p.created_at).setDate(diff)).toISOString().split('T')[0];

            if (!weeks[weekStart]) {
                weeks[weekStart] = { week_start: weekStart, total: 0, escrow: 0, released: 0, refunded: 0, count: 0 };
            }
            const amt = Number(p.amount);
            weeks[weekStart].total += amt;
            weeks[weekStart].count += 1;
            if (p.status === 'requires_capture') weeks[weekStart].escrow += amt;
            if (p.status === 'released') weeks[weekStart].released += amt;
            if (p.status === 'refunded') weeks[weekStart].refunded += amt;
        }

        // Totals
        const allPayments = payments || [];
        const summary = {
            total_spent: allPayments.reduce((s, p) => s + Number(p.amount), 0),
            total_released: allPayments.filter(p => p.status === 'released').reduce((s, p) => s + Number(p.amount), 0),
            total_in_escrow: allPayments.filter(p => p.status === 'requires_capture').reduce((s, p) => s + Number(p.amount), 0),
            total_refunded: allPayments.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0),
            transaction_count: allPayments.length,
            weeks: Object.values(weeks).sort((a, b) => a.week_start.localeCompare(b.week_start))
        };

        res.status(200).json({ success: true, data: summary });
    } catch (err) {
        next(err);
    }
};

// ─── TRANSACTION HISTORY ──────────────────────────────────────────────────────
// GET /api/reports/transactions?from=&to=&status=&contract_id=&page=&limit=
exports.getTransactionHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { from, to, status, contract_id, page = 1, limit = 20 } = req.query;

        const isClient = role === 'CLIENT';
        const userField = isClient ? 'payer_id' : 'payee_id';
        const offset = (Number(page) - 1) * Number(limit);

        let query = adminClient
            .from('payments')
            .select(`
                id, amount, status, description, created_at, updated_at,
                contract:contracts(id, title),
                payer:users!payments_payer_id_fkey(id, profiles(name, avatar_url)),
                payee:users!payments_payee_id_fkey(id, profiles(name, avatar_url))
            `, { count: 'exact' })
            .eq(userField, userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + Number(limit) - 1);

        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to + 'T23:59:59Z');
        if (status) query = query.eq('status', status);
        if (contract_id) query = query.eq('contract_id', contract_id);

        const { data, error, count } = await query;
        if (error) throw error;

        res.status(200).json({
            success: true,
            data: data || [],
            pagination: {
                total: count || 0,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil((count || 0) / Number(limit))
            }
        });
    } catch (err) {
        next(err);
    }
};

// ─── SPENDING BY ACTIVITY ─────────────────────────────────────────────────────
// GET /api/reports/spending-by-activity?from=&to=
exports.getSpendingByActivity = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const from = req.query.from || daysAgo(90);
        const to = req.query.to || new Date().toISOString().split('T')[0];

        const isClient = role === 'CLIENT';
        const userField = isClient ? 'payer_id' : 'payee_id';

        // Payments grouped by contract
        const { data: payments, error } = await adminClient
            .from('payments')
            .select(`
                amount, status, contract_id,
                contract:contracts(id, title, project_type, is_direct)
            `)
            .eq(userField, userId)
            .gte('created_at', from)
            .lte('created_at', to + 'T23:59:59Z');

        if (error) throw error;

        // Group by activity type
        const byType = {
            hourly: { label: 'Hourly Contracts', total: 0, count: 0 },
            fixed: { label: 'Fixed-Price Contracts', total: 0, count: 0 },
            direct: { label: 'Direct Contracts', total: 0, count: 0 },
            other: { label: 'Other', total: 0, count: 0 }
        };

        const byContract = {};

        for (const p of payments || []) {
            const amt = Number(p.amount);
            const c = p.contract;

            // By type
            if (c?.is_direct) {
                byType.direct.total += amt;
                byType.direct.count += 1;
            } else if (c?.project_type === 'HOURLY') {
                byType.hourly.total += amt;
                byType.hourly.count += 1;
            } else if (c?.project_type === 'FIXED') {
                byType.fixed.total += amt;
                byType.fixed.count += 1;
            } else {
                byType.other.total += amt;
                byType.other.count += 1;
            }

            // By contract
            if (p.contract_id) {
                if (!byContract[p.contract_id]) {
                    byContract[p.contract_id] = {
                        contract_id: p.contract_id,
                        title: c?.title || 'Unknown',
                        project_type: c?.project_type || 'FIXED',
                        is_direct: c?.is_direct || false,
                        total: 0,
                        count: 0
                    };
                }
                byContract[p.contract_id].total += amt;
                byContract[p.contract_id].count += 1;
            }
        }

        const grandTotal = Object.values(byType).reduce((s, t) => s + t.total, 0);

        // Add percentage
        const breakdown = Object.entries(byType)
            .filter(([, v]) => v.total > 0)
            .map(([key, v]) => ({
                key,
                ...v,
                percentage: grandTotal > 0 ? parseFloat(((v.total / grandTotal) * 100).toFixed(1)) : 0
            }));

        res.status(200).json({
            success: true,
            data: {
                grand_total: grandTotal,
                breakdown,
                by_contract: Object.values(byContract).sort((a, b) => b.total - a.total)
            }
        });
    } catch (err) {
        next(err);
    }
};
