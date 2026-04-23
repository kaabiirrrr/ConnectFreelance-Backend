const adminClient = require('../supabase/adminClient');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// POST /api/direct-contracts
// Client sends a direct contract offer to a freelancer
exports.createDirectContract = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const {
            freelancer_id,
            title,
            description,
            project_type = 'FIXED',
            agreed_rate,
            weekly_limit,
            start_date,
            end_date
        } = req.body;

        if (!freelancer_id || !UUID_REGEX.test(freelancer_id)) {
            return res.status(400).json({ success: false, message: 'Valid freelancer_id is required' });
        }
        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, message: 'Contract title is required' });
        }
        if (!agreed_rate || isNaN(Number(agreed_rate)) || Number(agreed_rate) <= 0) {
            return res.status(400).json({ success: false, message: 'Valid agreed_rate is required' });
        }
        if (!['HOURLY', 'FIXED'].includes(project_type)) {
            return res.status(400).json({ success: false, message: 'project_type must be HOURLY or FIXED' });
        }
        if (freelancer_id === clientId) {
            return res.status(400).json({ success: false, message: 'Cannot create a contract with yourself' });
        }

        // Verify freelancer exists
        const { data: freelancer, error: fErr } = await adminClient
            .from('users')
            .select('id, role')
            .eq('id', freelancer_id)
            .eq('role', 'FREELANCER')
            .maybeSingle();

        if (fErr || !freelancer) {
            return res.status(404).json({ success: false, message: 'Freelancer not found' });
        }

        const { data, error } = await adminClient
            .from('contracts')
            .insert([{
                client_id: clientId,
                freelancer_id,
                title: title.trim(),
                description: description?.trim() || null,
                project_type,
                agreed_rate: Number(agreed_rate),
                weekly_limit: weekly_limit ? Number(weekly_limit) : null,
                start_date: start_date || new Date().toISOString(),
                end_date: end_date || null,
                status: 'PENDING',
                is_direct: true,
                proposal_id: null,
                job_id: null
            }])
            .select()
            .single();

        if (error) throw error;

        // Auto-create a conversation thread for this contract
        const { data: existingConv } = await adminClient
            .from('conversations')
            .select('id')
            .or(`and(client_id.eq.${clientId},freelancer_id.eq.${freelancer_id}),and(client_id.eq.${freelancer_id},freelancer_id.eq.${clientId})`)
            .maybeSingle();

        if (!existingConv) {
            await adminClient.from('conversations').insert([{
                client_id: clientId,
                freelancer_id,
                contract_id: data.id
            }]);
        }

        // Notify freelancer
        await adminClient.from('notifications').insert([{
            user_id: freelancer_id,
            title: 'New Direct Contract Offer',
            content: `You have received a direct contract offer: "${title.trim()}"`,
            type: 'CONTRACT_UPDATE',
            link: `/contracts/${data.id}`
        }]);

        res.status(201).json({ success: true, data, message: 'Direct contract created successfully' });
    } catch (err) {
        next(err);
    }
};

// GET /api/direct-contracts
// List all direct contracts for the logged-in user (client or freelancer)
exports.listDirectContracts = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const roleField = role === 'CLIENT' ? 'client_id' : 'freelancer_id';

        const { data, error } = await adminClient
            .from('contracts')
            .select(`
                *,
                client:users!contracts_client_id_fkey(id, profiles(name, avatar_url)),
                freelancer:users!contracts_freelancer_id_fkey(id, profiles(name, avatar_url, title))
            `)
            .eq(roleField, userId)
            .eq('is_direct', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// GET /api/direct-contracts/:id
// Get a single direct contract by ID
exports.getDirectContract = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        if (!UUID_REGEX.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid contract ID' });
        }

        const { data, error } = await adminClient
            .from('contracts')
            .select(`
                *,
                client:users!contracts_client_id_fkey(id, profiles(name, avatar_url, company_name)),
                freelancer:users!contracts_freelancer_id_fkey(id, profiles(name, avatar_url, title, hourly_rate))
            `)
            .eq('id', id)
            .eq('is_direct', true)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'Contract not found' });

        if (data.client_id !== userId && data.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/direct-contracts/:id/status
exports.updateDirectContractStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { status } = req.body;

        const ALLOWED_TRANSITIONS = {
            PENDING:   ['ACTIVE', 'CANCELLED'],
            ACTIVE:    ['COMPLETED', 'CANCELLED'],
            COMPLETED: [],
            CANCELLED: []
        };

        const { data: contract, error: fetchErr } = await adminClient
            .from('contracts')
            .select('client_id, freelancer_id, status, title')
            .eq('id', id)
            .eq('is_direct', true)
            .maybeSingle();

        if (fetchErr || !contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }
        if (contract.client_id !== userId && contract.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const allowed = ALLOWED_TRANSITIONS[contract.status] || [];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Cannot transition from ${contract.status} to ${status}` });
        }

        // Only freelancer can accept (PENDING -> ACTIVE)
        if (status === 'ACTIVE' && contract.freelancer_id !== userId) {
            return res.status(403).json({ success: false, message: 'Only the freelancer can accept a contract' });
        }

        const { data, error } = await adminClient
            .from('contracts')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify the other party
        const notifyId = userId === contract.client_id ? contract.freelancer_id : contract.client_id;
        const notifyMessages = {
            ACTIVE: { title: 'Contract Accepted', content: `The direct contract "${contract.title}" has been accepted.` },
            COMPLETED: { title: 'Contract Completed', content: `The direct contract "${contract.title}" has been marked as completed.` },
            CANCELLED: { title: 'Contract Cancelled', content: `The direct contract "${contract.title}" has been cancelled.` }
        };

        if (notifyMessages[status]) {
            await adminClient.from('notifications').insert([{
                user_id: notifyId,
                title: notifyMessages[status].title,
                content: notifyMessages[status].content,
                type: 'CONTRACT_UPDATE',
                link: `/contracts/${id}`
            }]);
        }

        res.status(200).json({ success: true, data, message: `Contract ${status.toLowerCase()} successfully` });
    } catch (err) {
        next(err);
    }
};
