const adminClient = require('../supabase/adminClient');

/**
 * Log a new work entry in the hourly work diary.
 */
exports.logWork = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { contract_id, work_date, hours, description } = req.body;

        // 1. Verify contract ownership and type
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('id, freelancer_id, project_type, status')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.freelancer_id !== freelancerId) {
            return res.status(403).json({ success: false, message: 'Only the assigned freelancer can log work' });
        }

        if (contract.status !== 'ACTIVE' && contract.status !== 'IN_PROGRESS') {
            return res.status(400).json({ success: false, message: 'Can only log work for active contracts' });
        }

        // 2. Insert work diary entry
        const { data, error } = await adminClient
            .from('work_diary')
            .insert([{
                contract_id,
                freelancer_id: freelancerId,
                work_date,
                hours,
                description,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ 
            success: true, 
            data, 
            message: 'Work logged successfully' 
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Get work diary entries for a specific contract.
 */
exports.getWorkDiary = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contract_id } = req.query;

        if (!contract_id) {
            return res.status(400).json({ success: false, message: 'Contract ID is required' });
        }

        // Verify participation
        const { data: contract, error: contractError } = await adminClient
            .from('contracts')
            .select('client_id, freelancer_id')
            .eq('id', contract_id)
            .single();

        if (contractError || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (contract.client_id !== userId && contract.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this work diary' });
        }

        const { data, error } = await adminClient
            .from('work_diary')
            .select('*')
            .eq('contract_id', contract_id)
            .order('work_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

/**
 * Delete a work diary entry (only if PENDING).
 */
exports.deleteWorkEntry = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { id } = req.params;

        // Get entry and verify ownership
        const { data: entry, error: fetchError } = await adminClient
            .from('work_diary')
            .select('freelancer_id, status')
            .eq('id', id)
            .single();

        if (fetchError || !entry) {
            return res.status(404).json({ success: false, message: 'Work entry not found' });
        }

        if (entry.freelancer_id !== freelancerId) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this entry' });
        }

        if (entry.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Can only delete pending work entries' });
        }

        const { error } = await adminClient
            .from('work_diary')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Work entry deleted successfully' });
    } catch (err) {
        next(err);
    }
};
