const supabase = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * Get current user's lottery status for the active draw
 */
exports.getMyStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

        // 1. Fetch active draw for this month
        const { data: draw, error: drawError } = await supabase
            .from('lottery_draws')
            .select('*')
            .eq('month', currentMonth)
            .single();

        // If no draw exists for this month, user is not participating yet
        if (drawError || !draw) {
            return res.status(200).json({
                success: true,
                data: {
                    participating: false,
                    draw: null,
                    tickets: []
                }
            });
        }

        // 2. Fetch user's tickets for this draw
        const { data: tickets, error: ticketsError } = await supabase
            .from('lottery_tickets')
            .select('*')
            .eq('draw_id', draw.id)
            .eq('user_id', userId);

        if (ticketsError) throw ticketsError;

        res.status(200).json({
            success: true,
            data: {
                participating: tickets.length > 0,
                draw: draw,
                tickets: tickets
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current user's lottery win history
 */
exports.getMyHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const { data: history, error } = await supabase
            .from('lottery_winners')
            .select(`
                *,
                draw:lottery_draws(month, reward_distribution)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: history
        });
    } catch (error) {
        next(error);
    }
};
