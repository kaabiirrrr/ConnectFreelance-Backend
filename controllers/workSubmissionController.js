const adminClient = require('../supabase/adminClient');
const supabase = require('../supabase/client'); // For generic user operations if needed, but adminClient is better here

exports.submitWork = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { contract_id, description, attachment_url, attachment_name } = req.body;

        // Verify that the user is the freelancer on the contract
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('id, freelancer_id, client_id, status, jobs(title)')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.freelancer_id !== freelancerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned freelancer can submit work' });
        }

        if (contract.status !== 'ACTIVE' && contract.status !== 'IN_PROGRESS') {
            return res.status(400).json({ success: false, message: 'Can only submit work for active contracts' });
        }

        const { data, error } = await adminClient
            .from('work_submissions')
            .insert([{
                contract_id,
                freelancer_id: freelancerId,
                description,
                attachment_url,
                attachment_name,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        // Notify client
        await adminClient.from('notifications').insert([{
            user_id: contract.client_id,
            title: 'New Work Submission',
            content: `Work has been submitted for the contract: ${contract.jobs?.title || 'Unknown Project'}`,
            type: 'CONTRACT_UPDATE',
            link: `/client/contracts/${contract.id}`
        }]);

        res.status(201).json({ success: true, data, message: 'Work submitted successfully' });
    } catch (err) {
        next(err);
    }
};

exports.getContractSubmissions = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contractId } = req.params;

        // Verify participation
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('client_id, freelancer_id')
            .eq('id', contractId)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.client_id !== userId && contract.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized to view submissions for this contract' });
        }

        const { data, error } = await adminClient
            .from('work_submissions')
            .select('*')
            .eq('contract_id', contractId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

exports.updateSubmissionStatus = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { id } = req.params;
        const { status, client_feedback } = req.body;

        const allowedSlots = ['APPROVED', 'REQUEST_CHANGES', 'REJECTED'];
        if (!allowedSlots.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        // Get submission and verify client
        const { data: submission, error: subError } = await adminClient
            .from('work_submissions')
            .select('*, contracts(client_id, jobs(title))')
            .eq('id', id)
            .single();

        if (subError || !submission) {
            return res.status(404).json({ success: false, message: 'Submission not found' });
        }

        if (submission.contracts?.client_id !== clientId) {
             return res.status(403).json({ success: false, message: 'Only the client can review submissions' });
        }

        const { data, error } = await adminClient
            .from('work_submissions')
            .update({ status, client_feedback })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify freelancer
        let notifTitle = 'Submission Update';
        let notifContent = `Your submission for ${submission.contracts?.jobs?.title} has been updated.`;
        
        if (status === 'APPROVED') {
            notifTitle = 'Work Approved';
            notifContent = `Great news! Your work for ${submission.contracts?.jobs?.title} was approved.`;
        } else if (status === 'REQUEST_CHANGES') {
            notifTitle = 'Changes Requested';
            notifContent = `The client requested changes for ${submission.contracts?.jobs?.title}. Check the feedback.`;
        }

        await adminClient.from('notifications').insert([{
            user_id: submission.freelancer_id,
            title: notifTitle,
            content: notifContent,
            type: 'CONTRACT_UPDATE',
            link: `/freelancer/contracts/${submission.contract_id}`
        }]);

        res.status(200).json({ success: true, data, message: 'Submission status updated' });
    } catch (err) {
         next(err);
    }
};
