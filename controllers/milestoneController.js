const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const { releasePendingFunds } = require('./walletController');
const notificationHelper = require('../utils/notificationHelper');

// Valid status transitions
const VALID_TRANSITIONS = {
    'PENDING':     ['IN_PROGRESS'],
    'IN_PROGRESS': ['SUBMITTED'],
    'SUBMITTED':   ['APPROVED', 'REVISION'],
    'REVISION':    ['SUBMITTED'],
    'APPROVED':    []  // terminal state
};

// Who can trigger each transition
const TRANSITION_ROLES = {
    'IN_PROGRESS': 'freelancer',  // freelancer starts work
    'SUBMITTED':   'freelancer',  // freelancer submits deliverable
    'APPROVED':    'client',      // client approves
    'REVISION':    'client'       // client requests revision
};

/**
 * Create milestones for a contract
 * POST /api/milestones/create
 * Security: Contract client only
 */
exports.createMilestone = async (req, res, next) => {
    try {
        const { contract_id, title, description, amount, due_date } = req.body;
        const userId = req.user.id;

        // Verify contract exists and user is the client
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('id, client_id, freelancer_id, status')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.client_id !== userId) {
            return res.status(403).json({ success: false, message: 'Only the contract client can create milestones' });
        }

        if (contract.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: 'Milestones can only be added to active contracts' });
        }

        const { data: milestone, error } = await supabase
            .from('milestones')
            .insert([{
                contract_id,
                title,
                description: description || null,
                amount: amount || null,
                due_date: due_date || null,
                status: 'PENDING'
            }])
            .select('id, contract_id, title, status, amount, due_date')
            .single();

        if (error) throw error;

        // Notify freelancer about the new milestone
        await supabase.from('notifications').insert([{
            user_id: contract.freelancer_id,
            title: 'New Milestone',
            content: `A new milestone "${title}" has been created for your contract`,
            type: 'CONTRACT',
            link: '/freelancer/projects'
        }]).catch(() => {});

        res.status(201).json({ success: true, data: milestone, message: 'Milestone created' });
    } catch (error) {
        next(error);
    }
};

/**
 * Update milestone status with transition validation
 * PATCH /api/milestones/:id/status
 * Security: Client can APPROVE/REVISION, Freelancer can start/submit
 */
exports.updateStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status: newStatus } = req.body;
        const userId = req.user.id;

        // 1. Fetch milestone with contract info
        const { data: milestone, error: fetchError } = await supabase
            .from('milestones')
            .select('id, title, status, amount, contract_id, contracts ( client_id, freelancer_id )')
            .eq('id', id)
            .single();

        if (fetchError || !milestone) {
            return res.status(404).json({ success: false, message: 'Milestone not found' });
        }

        const contract = milestone.contracts;
        const isClient = contract.client_id === userId;
        const isFreelancer = contract.freelancer_id === userId;

        if (!isClient && !isFreelancer) {
            return res.status(403).json({ success: false, message: 'You are not a participant in this contract' });
        }

        // 2. Validate status transition
        const currentStatus = milestone.status;
        const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];

        if (!allowedTransitions.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${allowedTransitions.join(', ') || 'none'}`
            });
        }

        // 3. Validate role permission for this transition
        const requiredRole = TRANSITION_ROLES[newStatus];
        if (requiredRole === 'client' && !isClient) {
            return res.status(403).json({ success: false, message: 'Only the client can approve or request revision' });
        }
        if (requiredRole === 'freelancer' && !isFreelancer) {
            return res.status(403).json({ success: false, message: 'Only the freelancer can start or submit milestones' });
        }

        // 4. ENTERPRISE ENFORCEMENT: Only allow IN_PROGRESS if FUNDED
        if (newStatus === 'IN_PROGRESS' && currentStatus !== 'FUNDED') {
            return res.status(403).json({ 
                success: false, 
                message: 'Cannot start work: Milestone must be funded by the client first.',
                code: 'UNFUNDED_MILESTONE'
            });
        }

        // 5. Update the milestone
        const updateData = { status: newStatus };
        if (newStatus === 'APPROVED') {
            updateData.completed_at = new Date().toISOString();
        }

        const { data: updated, error: updateError } = await supabase
            .from('milestones')
            .update(updateData)
            .eq('id', id)
            .select('id, status, title, amount, completed_at')
            .single();

        if (updateError) throw updateError;

        // 5. If APPROVED, release payment to freelancer wallet
        if (newStatus === 'APPROVED' && milestone.amount) {
            await releasePendingFunds(contract.freelancer_id, parseFloat(milestone.amount));
        }

        // 6. Notify the other party
        const notifyUser = isClient ? contract.freelancer_id : contract.client_id;
        const statusMessages = {
            'IN_PROGRESS': 'Freelancer has started working on',
            'SUBMITTED': 'Freelancer has submitted',
            'APPROVED': 'Client has approved',
            'REVISION': 'Client has requested revision for'
        };

        await supabase.from('notifications').insert([{
            user_id: notifyUser,
            title: `Milestone ${newStatus}`,
            content: `${statusMessages[newStatus]} milestone: "${milestone.title}"`,
            type: 'CONTRACT',
            link: isClient ? '/freelancer/projects' : '/client/projects'
        }]).catch(() => {});

        // --- EMAIL NOTIFICATION ---
        try {
            await notificationHelper.checkAndSendNotification(notifyUser, 'email_contracts', {
                contractTitle: milestone.title, // or pass the actual contract title if we fetched it, but title is fine
                updateType: `Milestone status changed to ${newStatus}`,
                details: `${statusMessages[newStatus]} milestone.`
            });
        } catch (err) {
            console.error('[MilestoneController] Failed to send email update:', err.message);
        }

        res.status(200).json({
            success: true,
            data: updated,
            message: `Milestone status updated to ${newStatus}`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all milestones for a contract
 * GET /api/milestones/contract/:contractId
 * Security: Contract participants only
 */
exports.getContractMilestones = async (req, res, next) => {
    try {
        const { contractId } = req.params;
        const userId = req.user.id;

        // Verify user is participant
        const { data: contract, error: contractError } = await supabase
            .from('contracts')
            .select('client_id, freelancer_id')
            .eq('id', contractId)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.client_id !== userId && contract.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized to view these milestones' });
        }

        const { data: milestones, error } = await supabase
            .from('milestones')
            .select('id, contract_id, title, description, amount, status, due_date, completed_at, created_at')
            .eq('contract_id', contractId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Calculate progress summary
        const total = milestones.length;
        const approved = milestones.filter(m => m.status === 'APPROVED').length;
        const totalAmount = milestones.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
        const paidAmount = milestones.filter(m => m.status === 'APPROVED')
            .reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                milestones: milestones || [],
                summary: {
                    total,
                    approved,
                    pending: total - approved,
                    progress_percent: total > 0 ? Math.round((approved / total) * 100) : 0,
                    total_amount: totalAmount,
                    paid_amount: paidAmount,
                    remaining_amount: totalAmount - paidAmount
                }
            }
        });
    } catch (error) {
        next(error);
    }
};
