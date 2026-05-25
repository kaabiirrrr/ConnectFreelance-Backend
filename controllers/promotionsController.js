const adminClient = require('../supabase/adminClient');

const BOOST_COST = 10; // connects required to activate profile boost

// ─── Helper: ensure user has a connects wallet ────────────────────────────────
async function ensureWallet(userId) {
    const { data } = await adminClient
        .from('user_connects')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

    if (!data) {
        // Initialize wallet with 20 free connects
        const { data: newWallet } = await adminClient
            .from('user_connects')
            .insert([{ user_id: userId, balance: 20 }])
            .select('balance')
            .single();
        return newWallet?.balance ?? 0;
    }
    return data.balance ?? 0;
}

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

        res.status(200).json({
            success: true,
            data: {
                availability_badge: promoMap['availability_badge'] || {
                    type: 'availability_badge',
                    is_active: false,
                    impressions: 0,
                    clicks: 0
                },
                profile_boost: promoMap['profile_boost'] || {
                    type: 'profile_boost',
                    is_active: false,
                    impressions: 0,
                    clicks: 0
                }
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
            return res.status(400).json({
                success: false,
                message: `Type must be one of: ${validTypes.join(', ')}`
            });
        }

        // Get existing promotion to know current state
        const { data: existing } = await adminClient
            .from('promotions')
            .select('*')
            .eq('freelancer_id', freelancerId)
            .eq('type', type)
            .maybeSingle();

        const currentlyActive = existing?.is_active ?? false;
        const newActive = !currentlyActive;

        // Check connects balance for profile_boost activation
        if (type === 'profile_boost' && newActive) {
            const balance = await ensureWallet(freelancerId);
            if (balance < BOOST_COST) {
                return res.status(400).json({
                    success: false,
                    message: `Profile boost requires at least ${BOOST_COST} connects. You have ${balance}. Buy more connects to activate.`
                });
            }
        }

        const now = new Date().toISOString();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        let data, error;

        if (existing) {
            ({ data, error } = await adminClient
                .from('promotions')
                .update({
                    is_active: newActive,
                    started_at: newActive ? now : existing.started_at,
                    expires_at: newActive ? expires : existing.expires_at,
                    updated_at: now
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

        // Deduct connects atomically for profile_boost activation
        if (type === 'profile_boost' && newActive) {
            try {
                // Use the atomic RPC directly to deduct BOOST_COST connects
                const { data: newBalance, error: deductErr } = await adminClient.rpc('debit_connects_atomic', {
                    p_user_id: freelancerId,
                    p_amount: BOOST_COST,
                    p_action_source: 'profile_boost',
                    p_metadata: {
                        description: 'Profile Boost activation (30 days)',
                        promotion_id: data?.id,
                        source: 'profile_boost'
                    }
                });

                if (deductErr) {
                    // Roll back the promotion toggle
                    if (existing) {
                        await adminClient
                            .from('promotions')
                            .update({ is_active: false })
                            .eq('id', existing.id);
                    } else {
                        await adminClient
                            .from('promotions')
                            .delete()
                            .eq('id', data.id);
                    }

                    const isInsufficient = deductErr.message?.includes('INSUFFICIENT_CONNECTS') ||
                        deductErr.message?.includes('insufficient');
                    return res.status(400).json({
                        success: false,
                        message: isInsufficient
                            ? `Insufficient connects. You need ${BOOST_COST} connects to activate Profile Boost.`
                            : 'Failed to deduct connects. Please try again.'
                    });
                }
            } catch (deductErr) {
                console.error('[Promotions] Connect deduction failed:', deductErr.message);
                // Roll back the promotion toggle
                if (existing) {
                    await adminClient
                        .from('promotions')
                        .update({ is_active: false })
                        .eq('id', existing.id);
                } else if (data?.id) {
                    await adminClient
                        .from('promotions')
                        .delete()
                        .eq('id', data.id);
                }
                return res.status(400).json({
                    success: false,
                    message: 'Failed to deduct connects. Please try again.'
                });
            }
        }

        // Update profile status flags
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

        const promotions = data || [];
        const totalImpressions = promotions.reduce((s, p) => s + (p.impressions || 0), 0);
        const totalClicks = promotions.reduce((s, p) => s + (p.clicks || 0), 0);

        res.status(200).json({
            success: true,
            data: {
                promotions,
                total_impressions: totalImpressions,
                total_clicks: totalClicks,
                ctr: totalImpressions > 0
                    ? ((totalClicks / totalImpressions) * 100).toFixed(1)
                    : '0.0'
            }
        });
    } catch (err) {
        next(err);
    }
};
