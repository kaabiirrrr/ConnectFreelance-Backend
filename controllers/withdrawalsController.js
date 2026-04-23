const adminClient = require('../supabase/adminClient');

// GET /api/withdrawals — freelancer's withdrawal history + available balance
exports.getWithdrawals = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;

        const [withdrawalsRes, paymentsRes] = await Promise.all([
            adminClient
                .from('withdrawals')
                .select('*')
                .eq('freelancer_id', freelancerId)
                .order('created_at', { ascending: false }),
            adminClient
                .from('payments')
                .select('amount, status')
                .eq('payee_id', freelancerId)
                .eq('status', 'released')
        ]);

        if (withdrawalsRes.error) throw withdrawalsRes.error;

        const totalEarned = (paymentsRes.data || []).reduce((s, p) => s + Number(p.amount), 0);
        const totalWithdrawn = (withdrawalsRes.data || [])
            .filter(w => ['COMPLETED', 'PROCESSING'].includes(w.status))
            .reduce((s, w) => s + Number(w.amount), 0);
        const pendingWithdrawals = (withdrawalsRes.data || [])
            .filter(w => w.status === 'PENDING')
            .reduce((s, w) => s + Number(w.amount), 0);

        const availableBalance = Math.max(0, totalEarned - totalWithdrawn - pendingWithdrawals);

        res.status(200).json({
            success: true,
            data: {
                withdrawals: withdrawalsRes.data || [],
                balance: {
                    total_earned: totalEarned,
                    total_withdrawn: totalWithdrawn,
                    pending: pendingWithdrawals,
                    available: availableBalance
                }
            }
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/withdrawals — request a withdrawal
exports.requestWithdrawal = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { amount, method, account_details } = req.body;

        if (!amount || isNaN(amount) || Number(amount) <= 0) {
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }
        if (!method || !['bank_transfer', 'paypal', 'stripe'].includes(method)) {
            return res.status(400).json({ success: false, message: 'method must be bank_transfer, paypal, or stripe' });
        }
        if (!account_details || typeof account_details !== 'object') {
            return res.status(400).json({ success: false, message: 'account_details are required' });
        }

        // --- 🛡️ BANK-GRADE: WITHDRAWAL COOLING (30s) ---
        const { data: lastWithdrawal } = await adminClient
            .from('withdrawals')
            .select('created_at')
            .eq('freelancer_id', freelancerId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastWithdrawal) {
            const lastTime = new Date(lastWithdrawal.created_at).getTime();
            const now = Date.now();
            if (now - lastTime < 30000) {
                return res.status(429).json({ 
                    success: false, 
                    message: `Withdrawal cooling active. Please wait ${Math.ceil((30000 - (now - lastTime)) / 1000)}s.` 
                });
            }
        }


        // --- 🛡️ BANK-GRADE: ATOMIC WITHDRAWAL (RPC v3) ---
        const { executeWithRetry } = require('../utils/dbUtils');
        
        const result = await executeWithRetry(async () => {
            const { data, error } = await adminClient.rpc('request_withdrawal_v3', {
                p_amount: Number(amount),
                p_method: method,
                p_account_details: account_details
            });
            if (error) throw error;
            return data;
        });

        if (!result || !result.success) {
            return res.status(400).json({
                success: false,
                message: result?.message || 'Withdrawal request failed.'
            });
        }

        const data = result;

        // Notify admins
        const { data: admins } = await adminClient.from('admins').select('id').in('role', ['SUPER_ADMIN', 'FINANCE_ADMIN']);
        if (admins?.length) {
            await adminClient.from('notifications').insert(
                admins.map(a => ({
                    user_id: a.id,
                    title: 'New Withdrawal Request',
                    content: `A freelancer has requested a withdrawal of $${Number(amount).toFixed(2)} via ${method}.`,
                    type: 'SYSTEM',
                    link: '/admin/withdrawals'
                }))
            );
        }

        res.status(201).json({ 
            success: true, 
            data, 
            message: 'Withdrawal request submitted successfully' 
        });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/withdrawals/:id/cancel — freelancer cancels a pending withdrawal
exports.cancelWithdrawal = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { id } = req.params;

        const { data: w } = await adminClient.from('withdrawals').select('freelancer_id, status').eq('id', id).maybeSingle();
        if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
        if (w.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Not authorized' });
        if (w.status !== 'PENDING') return res.status(400).json({ success: false, message: 'Only pending withdrawals can be cancelled' });

        const { data, error } = await adminClient.from('withdrawals').update({ status: 'REJECTED', rejection_reason: 'Cancelled by freelancer' }).eq('id', id).select().single();
        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Withdrawal cancelled' });
    } catch (err) {
        next(err);
    }
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────

exports.adminGetWithdrawals = async (req, res, next) => {
    try {
        const { status = 'PENDING', page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const { data, error, count } = await adminClient
            .from('withdrawals')
            .select('*', { count: 'exact' })
            .eq('status', status)
            .order('created_at', { ascending: true })
            .range(offset, offset + Number(limit) - 1);

        if (error) throw error;

        const ids = (data || []).map(w => w.freelancer_id);
        const { data: profiles } = ids.length
            ? await adminClient.from('profiles').select('user_id, name, avatar_url').in('user_id', ids)
            : { data: [] };
        const pm = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        const enriched = (data || []).map(w => ({ ...w, freelancer: pm[w.freelancer_id] || null }));
        res.status(200).json({ success: true, data: enriched, pagination: { total: count || 0, page: Number(page), limit: Number(limit) } });
    } catch (err) {
        next(err);
    }
};

exports.adminProcessWithdrawal = async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const { id } = req.params;
        const { action, rejection_reason } = req.body;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'action must be approve or reject' });
        }

        const { data: w } = await adminClient.from('withdrawals').select('freelancer_id, status, amount').eq('id', id).maybeSingle();
        if (!w) return res.status(404).json({ success: false, message: 'Withdrawal not found' });
        
        // --- 🏦 BANK-GRADE: ATOMIC STATE MACHINE (RPC) ---
        const { executeWithRetry } = require('../utils/dbUtils');
        
        const result = await executeWithRetry(async () => {
            const { data, error } = await adminClient.rpc('process_withdrawal_v2', {
                p_withdrawal_id: id,
                p_admin_id: adminId,
                p_action: action === 'approve' ? 'APPROVE' : 'REJECT'
            });
            if (error) throw error;
            return data;
        });

        if (!result || !result.success) {
            return res.status(409).json({ 
                success: false, 
                message: result?.message || 'Conflict detected: Withdrawal status was changed by another administrator or request is already processed.' 
            });
        }

        const data = result;


        // --- COMPLIANCE: AUDIT LOGGING ---
        try {
            const { logAction } = require('./admin/adminAuditController');
            await logAction(
                adminId,
                `WITHDRAWAL_${action.toUpperCase()}`,
                id,
                `Withdrawal ${id} set to ${newStatus}. IP: ${req.ip || 'unknown'}`
            );
        } catch (logErr) {
            console.error('[AdminAudit] Failed to log withdrawal action:', logErr);
        }

        await adminClient.from('notifications').insert([{
            user_id: w.freelancer_id,
            title: action === 'approve' ? 'Withdrawal Approved' : 'Withdrawal Rejected',
            content: action === 'approve'
                ? `Your withdrawal of $${Number(w.amount).toFixed(2)} has been approved and completed.`
                : `Your withdrawal was rejected. ${rejection_reason || ''}`,
            type: 'SYSTEM'
        }]);

        res.status(200).json({ success: true, data });

    } catch (err) {
        next(err);
    }
};
