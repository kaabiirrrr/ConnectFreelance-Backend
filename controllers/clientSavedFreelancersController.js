const adminClient = require('../supabase/adminClient');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(s) {
    return typeof s === 'string' && UUID_REGEX.test(s);
}

function formatPrice(hourlyRate) {
    if (hourlyRate == null || hourlyRate === '') return null;
    const n = Number(hourlyRate);
    if (Number.isNaN(n)) return String(hourlyRate);
    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}/hr`;
}

function mapFreelancerSummary(profile, savedAt) {
    if (!profile) return null;
    const rating = profile.rating != null ? Number(profile.rating) : null;
    const sd = (typeof profile.step_data === 'object' && profile.step_data) ? profile.step_data : {};
    
    // Resolve experience_years from all step_data paths
    const experience_years =
        sd.professional_info?.experience ||
        sd.personal_info?.experience ||
        sd.professional?.experience ||
        sd.experience ||
        profile.experience_years ||
        '';

    // Resolve work_hours
    const work_hours =
        sd.professional_info?.work_hours ||
        sd.professional?.work_hours ||
        sd.work_hours ||
        profile.work_hours ||
        null;

    return {
        id: profile.user_id,
        name: profile.name,
        title: profile.title || '',
        image: profile.avatar_url || null,
        skills: Array.isArray(profile.skills) ? profile.skills : [],
        rating: Number.isFinite(rating) ? rating : null,
        price: formatPrice(profile.hourly_rate),
        saved_at: savedAt,
        reliability_score: profile.reliability_score,
        experience_years: experience_years,
        work_hours: work_hours,
        is_verified: profile.is_verified,
        has_availability_badge: profile.has_availability_badge
    };
}

async function assertFreelancerUser(freelancerId) {
    const { data: userRow, error: userErr } = await adminClient
        .from('users')
        .select('id, role')
        .eq('id', freelancerId)
        .maybeSingle();

    if (userErr || !userRow) return false;
    return userRow.role === 'FREELANCER';
}

exports.listSavedFreelancers = async (req, res, next) => {
    try {
        const clientId = req.user.id;

        const { data: rows, error } = await adminClient
            .from('client_saved_freelancers')
            .select('freelancer_id, created_at')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const list = rows || [];
        if (list.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        const ids = list.map((r) => r.freelancer_id);
        const { data: profiles, error: pErr } = await adminClient
            .from('profiles')
            .select('*')
            .in('user_id', ids);

        if (pErr) throw pErr;

        const byId = Object.fromEntries((profiles || []).map((p) => [p.user_id, p]));
        const data = [];
        for (const row of list) {
            const summary = mapFreelancerSummary(byId[row.freelancer_id], row.created_at);
            if (summary) data.push(summary);
        }

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

exports.saveFreelancer = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const freelancerId = req.body?.freelancer_id;

        if (!freelancerId || !isValidUuid(freelancerId)) {
            return res.status(400).json({
                success: false,
                data: null,
                message: 'Valid freelancer_id (UUID) is required'
            });
        }

        if (freelancerId === clientId) {
            return res.status(400).json({
                success: false,
                data: null,
                message: 'Cannot save your own profile as a freelancer'
            });
        }

        const ok = await assertFreelancerUser(freelancerId);
        if (!ok) {
            return res.status(404).json({
                success: false,
                data: null,
                message: 'Freelancer not found'
            });
        }

        const { data: existing, error: exErr } = await adminClient
            .from('client_saved_freelancers')
            .select('id, created_at')
            .eq('client_id', clientId)
            .eq('freelancer_id', freelancerId)
            .maybeSingle();

        if (exErr) throw exErr;

        let savedAt;
        let created = false;

        if (existing) {
            savedAt = existing.created_at;
        } else {
            const { data: inserted, error: insErr } = await adminClient
                .from('client_saved_freelancers')
                .insert([{ client_id: clientId, freelancer_id: freelancerId }])
                .select('created_at')
                .single();

            if (insErr) {
                if (insErr.code === '23505') {
                    const { data: again } = await adminClient
                        .from('client_saved_freelancers')
                        .select('created_at')
                        .eq('client_id', clientId)
                        .eq('freelancer_id', freelancerId)
                        .single();
                    savedAt = again?.created_at;
                } else {
                    throw insErr;
                }
            } else {
                savedAt = inserted.created_at;
                created = true;
            }
        }

        const { data: profile, error: profErr } = await adminClient
            .from('profiles')
            .select('*')
            .eq('user_id', freelancerId)
            .single();

        if (profErr || !profile) {
            return res.status(404).json({
                success: false,
                data: null,
                message: 'Freelancer profile not found'
            });
        }

        if (!savedAt) {
            return res.status(500).json({
                success: false,
                data: null,
                message: 'Could not resolve save timestamp'
            });
        }

        const data = mapFreelancerSummary(profile, savedAt);
        res.status(created ? 201 : 200).json({
            success: true,
            data,
            message: created ? 'Freelancer saved' : 'Already saved'
        });
    } catch (err) {
        next(err);
    }
};

exports.removeSavedFreelancer = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { freelancerId } = req.params;

        if (!freelancerId || !isValidUuid(freelancerId)) {
            return res.status(400).json({
                success: false,
                data: null,
                message: 'Valid freelancer id (UUID) is required'
            });
        }

        const { data: deleted, error } = await adminClient
            .from('client_saved_freelancers')
            .delete()
            .eq('client_id', clientId)
            .eq('freelancer_id', freelancerId)
            .select('id');

        if (error) throw error;

        if (!deleted || deleted.length === 0) {
            return res.status(404).json({
                success: false,
                data: null,
                message: 'Saved freelancer not found'
            });
        }

        res.status(200).json({
            success: true,
            data: null,
            message: 'Freelancer removed from saved list'
        });
    } catch (err) {
        next(err);
    }
};
