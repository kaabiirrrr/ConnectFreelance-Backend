const adminClient = require('../supabase/adminClient');

// GET /api/promotions/my — get freelancer's promotion status
exports.getMyPromotions = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;

        const { data, error } = await adminClient
            .from('promotions')
            .select('*')
            .eq('freelancer_id', freelancerId);

        if (error) throw error;

        // Build a map of type -> promotion
        const promoMap = Object.fromEntries((data || []).map(p => [p.type, p]));

        // Return structured response with defaults
        res.status(200).json({
            success: true,
            data: {
                availability_badge: promoMap['availability_badge'] || { type: 'availability_badge', is_active: false, impressions: 0, clicks: 0 },
                profile_boost: promoMap['profile_boost'] || { type: 'profile_boost', is_active: false, impressions: 0, clicks: 0 }
            }
        });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/promotions/:type — toggle a promotion on/off
exports.togglePromotion = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { type } = req.params;

        const validTypes = ['availability_badge', 'profile_boost'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, message: `Type must be one of: ${validTypes.join(', ')}` });
        }

        // Check connects balance for profile_boost (costs connects)
        if (type === 'profile_boost') {
            const { data: connects } = await adminClient
                .from('connects')
                .select('balance')
                .eq('freelancer_id', freelancerId)
                .maybeSingle();

            const balance = connects?.balance || 0;
            if (balance < 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Profile boost requires at least 10 connects. Buy more connects to activate.'
                });
            }
        }

        // Get existing promotion
        const { data: existing } = await adminClient
            .from('promotions')
            .select('*')
            .eq('freelancer_id', freelancerId)
            .eq('type', type)
            .maybeSingle();

        const newActive = existing ? !existing.is_active : true;
        const now = new Date().toISOString();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        let data, error;

        if (existing) {
            ({ data, error } = await adminClient
                .from('promotions')
                .update({
                    is_active: newActive,
                    started_at: newActive ? now : existing.started_at,
                    expires_at: newActive ? expires : existing.expires_at
                })
                .eq('id', existing.id)
                .select()
                .single());
        } else {
            ({ data, error } = await adminClient
                .from('promotions')
                .insert([{
                    freelancer_id: freelancerId,
                    type,
                    is_active: true,
                    started_at: now,
                    expires_at: expires
                }])
                .select()
                .single());
        }

        if (error) throw error;

        // Deduct connects for profile_boost activation
        if (type === 'profile_boost' && newActive) {
            const { data: connects } = await adminClient
                .from('connects')
                .select('balance')
                .eq('freelancer_id', freelancerId)
                .maybeSingle();

            if (connects) {
                await adminClient
                    .from('connects')
                    .update({ balance: Math.max(0, connects.balance - 10) })
                    .eq('freelancer_id', freelancerId);
            }
        }

        // Update profile status flags based on type
        const profileUpdates = {};
        if (type === 'profile_boost') {
            profileUpdates.is_featured = newActive;
            profileUpdates.featured_until = newActive ? expires : null;
        } else if (type === 'availability_badge') {
            profileUpdates.has_availability_badge = newActive;
            profileUpdates.availability_badge_until = newActive ? expires : null;
        }

        if (Object.keys(profileUpdates).length > 0) {
            await adminClient
                .from('profiles')
                .update(profileUpdates)
                .eq('user_id', freelancerId);
        }

        res.status(200).json({
            success: true,
            data,
            message: `${type.replace('_', ' ')} ${newActive ? 'activated' : 'deactivated'}`
        });
    } catch (err) {
        next(err);
    }
};

// GET /api/promotions/stats — impressions and clicks
exports.getPromotionStats = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;

        const { data, error } = await adminClient
            .from('promotions')
            .select('type, is_active, impressions, clicks, started_at, expires_at')
            .eq('freelancer_id', freelancerId);

        if (error) throw error;

        const totalImpressions = (data || []).reduce((s, p) => s + (p.impressions || 0), 0);
        const totalClicks = (data || []).reduce((s, p) => s + (p.clicks || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                promotions: data || [],
                total_impressions: totalImpressions,
                total_clicks: totalClicks,
                ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0'
            }
        });
    } catch (err) {
        next(err);
    }
};
