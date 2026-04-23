const supabase = require('../../supabase/adminClient');
const { logAction } = require('./adminAuditController');
const logger = require('../../utils/logger');

/**
 * List all lottery draws
 */
exports.getDraws = async (req, res, next) => {
    try {
        const { data: draws, error } = await supabase
            .from('lottery_draws')
            .select('*')
            .order('month', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: draws
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create a new lottery draw
 */
exports.createDraw = async (req, res, next) => {
    try {
        const { month, reward_distribution } = req.body;

        if (!month || !reward_distribution) {
            return res.status(400).json({ success: false, message: 'Month and reward distribution are required' });
        }

        const { data: draw, error } = await supabase
            .from('lottery_draws')
            .insert({
                month,
                reward_distribution,
                status: 'PENDING',
                total_participants: 0,
                total_tickets: 0
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ success: false, message: `A draw for ${month} already exists.` });
            }
            throw error;
        }

        await logAction(req.user.id, 'LOTTERY_DRAW_CREATE', draw.id, `Created lottery draw for ${month}`);

        res.status(201).json({
            success: true,
            data: draw
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Run lottery draw (Select winners)
 */
exports.runLottery = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 1. Fetch draw details
        const { data: draw, error: drawError } = await supabase
            .from('lottery_draws')
            .select('*')
            .eq('id', id)
            .single();

        if (drawError || !draw) {
            return res.status(404).json({ success: false, message: 'Draw not found' });
        }

        if (draw.status === 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'This lottery has already been run.' });
        }

        // 2. Fetch all unique participants and their tickets
        const { data: tickets, error: ticketsError } = await supabase
            .from('lottery_tickets')
            .select('user_id, ticket_number')
            .eq('draw_id', id);

        if (ticketsError) throw ticketsError;

        if (!tickets || tickets.length === 0) {
            return res.status(400).json({ success: false, message: 'No participants found for this draw.' });
        }

        // Update status to RUNNING
        await supabase.from('lottery_draws').update({ status: 'RUNNING' }).eq('id', id);

        // 3. Select winners based on reward_distribution
        // A user can only win once per draw
        const participants = [...new Set(tickets.map(t => t.user_id))];
        const winners = [];
        const distribution = draw.reward_distribution; // [{position: 1, amount: 5000}, ...]

        // Shuffle participants for randomness
        const shuffled = participants.sort(() => Math.random() - 0.5);

        for (let i = 0; i < distribution.length && i < shuffled.length; i++) {
            winners.push({
                draw_id: id,
                user_id: shuffled[i],
                position: distribution[i].position,
                reward_amount: distribution[i].amount
            });
        }

        // 4. Save winners
        const { error: winnersError } = await supabase
            .from('lottery_winners')
            .insert(winners);

        if (winnersError) throw winnersError;

        // 5. Update draw status to COMPLETED and record stats
        const { error: updateError } = await supabase
            .from('lottery_draws')
            .update({
                status: 'COMPLETED',
                total_participants: participants.length,
                total_tickets: tickets.length
            })
            .eq('id', id);

        if (updateError) throw updateError;

        await logAction(req.user.id, 'LOTTERY_RUN', id, `Ran lottery draw for ${draw.month}. Winners: ${winners.length}`);

        res.status(200).json({
            success: true,
            message: 'Lottery run successfully',
            data: { winners_count: winners.length }
        });
    } catch (error) {
        // Rollback status if possible
        await supabase.from('lottery_draws').update({ status: 'PENDING' }).eq('id', req.params.id);
        next(error);
    }
};

/**
 * Get winners for a draw
 */
exports.getWinners = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { data: winners, error } = await supabase
            .from('lottery_winners')
            .select(`
                *,
                user:profiles(name, avatar_url)
            `)
            .eq('draw_id', id)
            .order('position', { ascending: true });

        if (error) throw error;

        // Add email from users table if needed
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, email')
            .in('id', winners.map(w => w.user_id));

        if (!userError) {
            winners.forEach(w => {
                const user = users.find(u => u.id === w.user_id);
                if (w.user) w.user.email = user?.email;
            });
        }

        res.status(200).json({
            success: true,
            data: winners
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a draw
 */
exports.deleteDraw = async (req, res, next) => {
    try {
        const { id } = req.params;

        const { data: draw, error: fetchError } = await supabase
            .from('lottery_draws')
            .select('status, month')
            .eq('id', id)
            .single();

        if (fetchError || !draw) {
            return res.status(404).json({ success: false, message: 'Draw not found' });
        }

        if (draw.status === 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Completed draws cannot be deleted.' });
        }

        const { error: deleteError } = await supabase
            .from('lottery_draws')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        await logAction(req.user.id, 'LOTTERY_DRAW_DELETE', id, `Deleted lottery draw for ${draw.month}`);

        res.status(200).json({
            success: true,
            message: 'Draw deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};
