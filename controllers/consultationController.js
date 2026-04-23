const adminClient = require('../supabase/adminClient');

const CATEGORIES = ['Development & IT', 'AI Services', 'Marketing', 'Design', 'Writing', 'Finance', 'Legal', 'HR'];

// GET /api/consultations/experts?category=&search=
exports.getExperts = async (req, res, next) => {
    try {
        const { category, search } = req.query;

        // Get freelancer IDs
        const { data: freelancers } = await adminClient
            .from('users')
            .select('id')
            .eq('role', 'FREELANCER');

        const ids = (freelancers || []).map(f => f.id);
        if (!ids.length) return res.status(200).json({ success: true, data: [] });

        let query = adminClient
            .from('profiles')
            .select('user_id, name, avatar_url, title, skills, hourly_rate, bio, category, is_verified, is_featured')
            .in('user_id', ids)

            .not('hourly_rate', 'is', null);

        if (category) query = query.eq('category', category);
        if (search) query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%`);

        const { data, error } = await query.order('is_featured', { ascending: false }).limit(20);
        if (error) throw error;

        res.status(200).json({ success: true, data: data || [], categories: CATEGORIES });
    } catch (err) {
        next(err);
    }
};

// POST /api/consultations — book a consultation
exports.bookConsultation = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { expert_id, category, title, description, duration_minutes = 30, scheduled_at } = req.body;

        if (!expert_id || !title || !scheduled_at) {
            return res.status(400).json({ success: false, message: 'expert_id, title and scheduled_at are required' });
        }

        // Get expert's rate
        const { data: profile } = await adminClient
            .from('profiles')
            .select('hourly_rate, name')
            .eq('user_id', expert_id)
            .maybeSingle();

        const rate = profile?.hourly_rate ? (Number(profile.hourly_rate) * duration_minutes / 60) : 0;

        const { data, error } = await adminClient
            .from('consultations')
            .insert([{
                expert_id,
                client_id: clientId,
                category: category || 'General',
                title,
                description: description || null,
                duration_minutes,
                rate,
                scheduled_at,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        // Notify expert
        await adminClient.from('notifications').insert([{
            user_id: expert_id,
            title: 'New Consultation Request',
            content: `You have a new consultation request: "${title}"`,
            type: 'SYSTEM',
            link: `/consultations/${data.id}`
        }]);

        res.status(201).json({ success: true, data, message: 'Consultation booked' });
    } catch (err) {
        next(err);
    }
};

// GET /api/consultations — list my consultations
exports.getMyConsultations = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const field = role === 'CLIENT' ? 'client_id' : 'expert_id';

        const { data, error } = await adminClient
            .from('consultations')
            .select('*')
            .eq(field, userId)
            .order('scheduled_at', { ascending: true });

        if (error) throw error;

        // Enrich with profiles
        const ids = [...new Set((data || []).flatMap(c => [c.expert_id, c.client_id]))];
        const { data: profiles } = await adminClient.from('profiles').select('user_id, name, avatar_url').in('user_id', ids);
        const pm = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));


        const enriched = (data || []).map(c => ({
            ...c,
            expert: pm[c.expert_id] || null,
            client: pm[c.client_id] || null
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/consultations/:id/status
exports.updateConsultationStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { status, meeting_link, notes } = req.body;

        const allowed = ['CONFIRMED', 'COMPLETED', 'CANCELLED'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
        }

        const { data: c } = await adminClient.from('consultations').select('expert_id, client_id').eq('id', id).maybeSingle();
        if (!c || (c.expert_id !== userId && c.client_id !== userId)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const updates = { status };
        if (meeting_link) updates.meeting_link = meeting_link;
        if (notes) updates.notes = notes;

        const { data, error } = await adminClient.from('consultations').update(updates).eq('id', id).select().single();
        if (error) throw error;

        const notifyId = userId === c.expert_id ? c.client_id : c.expert_id;
        await adminClient.from('notifications').insert([{
            user_id: notifyId,
            title: `Consultation ${status}`,
            content: `Your consultation has been ${status.toLowerCase()}.`,
            type: 'SYSTEM',
            link: `/consultations/${id}`
        }]);

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};
