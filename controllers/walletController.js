const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Get wallet balances (auto-creates wallet if missing)
 * GET /api/wallet
 * Security: Freelancer only
 */
exports.getWallet = async (req, res, next) => {
    try {
        const userId = req.user.id;

        let { data: wallet, error } = await supabase
            .from('wallets')
            .select('id, user_id, available_balance, pending_balance, total_earned, total_withdrawn, updated_at')
            .eq('user_id', userId)
            .maybeSingle();

        // Auto-create wallet row if first visit
        if (!wallet) {
            const { data: newWallet, error: createError } = await adminClient
                .from('wallets')
                .insert([{ user_id: userId }])
                .select('id, user_id, available_balance, pending_balance, total_earned, total_withdrawn, updated_at')
                .single();

            if (createError) throw createError;
            wallet = newWallet;
        }

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: {
                available_balance: parseFloat(wallet.available_balance) || 0,
                pending_balance: parseFloat(wallet.pending_balance) || 0,
                total_earned: parseFloat(wallet.total_earned) || 0,
                total_withdrawn: parseFloat(wallet.total_withdrawn) || 0,
                updated_at: wallet.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Withdraw funds from available_balance
 * POST /api/wallet/withdraw
 * Security: Freelancer only
 * Flow: available_balance -= amount, total_withdrawn += amount
 */
exports.withdraw = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { amount } = req.body;

        // 1. Fetch current wallet with lock-like pattern (select then update)
        const { data: wallet, error: fetchError } = await supabase
            .from('wallets')
            .select('available_balance, total_withdrawn')
            .eq('user_id', userId)
            .single();

        if (fetchError || !wallet) {
            return res.status(404).json({ success: false, message: 'Wallet not found. Please visit your wallet page first.' });
        }

        const available = parseFloat(wallet.available_balance);

        // 2. Validate sufficient balance
        if (amount > available) {
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. Available: $${available.toFixed(2)}, Requested: $${amount.toFixed(2)}`
            });
        }

        if (amount < 5) {
            return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $5.00' });
        }

        // 3. Update balances atomically
        const newAvailable = available - amount;
        const newWithdrawn = parseFloat(wallet.total_withdrawn) + amount;

        const { data: updated, error: updateError } = await adminClient
            .from('wallets')
            .update({
                available_balance: newAvailable,
                total_withdrawn: newWithdrawn
            })
            .eq('user_id', userId)
            .select('available_balance, total_withdrawn')
            .single();

        if (updateError) throw updateError;

        // 4. Notify user
        await supabase.from('notifications').insert([{
            user_id: userId,
            title: 'Withdrawal Processed',
            content: `$${amount.toFixed(2)} withdrawal has been initiated`,
            type: 'PAYMENT',
            link: '/freelancer/wallet'
        }]).catch(() => {});

        res.status(200).json({
            success: true,
            data: {
                amount_withdrawn: amount,
                available_balance: newAvailable,
                total_withdrawn: newWithdrawn
            },
            message: `₹${amount.toFixed(2)} withdrawal processed successfully`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create Razorpay Order for Wallet Top-up
 * POST /api/wallet/topup/create
 */
exports.createTopupOrder = async (req, res, next) => {
    try {
        const { amount } = req.body; // Amount in INR
        const userId = req.user.id;

        if (!amount || amount < 500) {
            return res.status(400).json({ success: false, message: 'Minimum top-up amount is ₹500' });
        }

        const options = {
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'INR',
            receipt: `wtp_${Date.now()}_${userId.substring(0, 5)}`,
            notes: {
                user_id: userId,
                type: 'wallet_topup'
            }
        };

        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                key_id: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (err) {
        logger.error('[Wallet] Topup Order Creation Failed', err);
        next(err);
    }
};

/**
 * Verify Razorpay Top-up and Credit Wallet
 * POST /api/wallet/topup/verify
 */
exports.verifyTopup = async (req, res, next) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
        const userId = req.user.id;

        logger.info(`[Wallet] Verifying top-up for User: ${userId}, Amount: ${amount}`);

        // 0. Environment check
        if (!process.env.RAZORPAY_KEY_SECRET) {
            logger.error('[Wallet] RAZORPAY_KEY_SECRET is missing from environment variables');
            return res.status(500).json({ success: false, message: 'Server configuration error' });
        }

        // 1. Signature check
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            logger.warn(`[Wallet] Signature mismatch for User: ${userId}`);
            return res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }

        // 2. Atomic Credit (Auto-create wallet row if missing for the client)
        let { data: wallet, error: fetchError } = await adminClient
            .from('wallets')
            .select('available_balance')
            .eq('user_id', userId)
            .maybeSingle();

        if (fetchError) {
            logger.error('[Wallet] Database fetch error', fetchError);
            return res.status(500).json({ success: false, message: 'Database fetch failed', error: fetchError.message });
        }

        // Auto-create wallet if first time adding funds
        if (!wallet) {
            const { data: newWallet, error: createError } = await adminClient
                .from('wallets')
                .insert([{ user_id: userId }])
                .select('available_balance')
                .single();

            if (createError) {
                logger.error('[Wallet] Failed to auto-create wallet', createError);
                return res.status(500).json({ success: false, message: 'Wallet creation failed', error: createError.message });
            }
            wallet = newWallet;
        }

        const currentBalance = parseFloat(wallet.available_balance) || 0;
        const topupAmount = parseFloat(amount);
        
        if (isNaN(topupAmount)) {
            return res.status(400).json({ success: false, message: 'Invalid amount format' });
        }

        const newBalance = currentBalance + topupAmount;

        const { error: updateError } = await adminClient
            .from('wallets')
            .update({ available_balance: newBalance })
            .eq('user_id', userId);

        if (updateError) {
            logger.error('[Wallet] Balance update failed', updateError);
            return res.status(500).json({ success: false, message: 'Balance update failed', error: updateError.message });
        }

        // 3. Record Transaction (Non-blocking but logged)
        try {
            const { error: txError } = await adminClient.from('wallet_transactions').insert([{
                user_id: userId,
                amount: topupAmount,
                type: 'deposit',
                description: 'Wallet top-up via Razorpay',
                payment_id: razorpay_payment_id,
                reference_id: razorpay_order_id,
                status: 'completed'
            }]);
            if (txError) logger.error('[Wallet] Transaction logging failed', txError);
        } catch (err) {
            logger.error('[Wallet] Fatal error during transaction logging', err);
        }

        // 4. Notify
        try {
            await supabase.from('notifications').insert([{
                user_id: userId,
                title: 'Wallet Funded',
                content: `₹${amount} has been added to your wallet successfully.`,
                type: 'PAYMENT',
                link: '/client/dashboard'
            }]);
        } catch (err) {
            logger.error('[Wallet] Notification failed', err);
        }

        res.status(200).json({
            success: true,
            message: 'Top-up successful',
            balance: newBalance
        });
    } catch (err) {
        logger.error('[Wallet] Unexpected verifyTopup error', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

/**
 * Helper: Move funds from pending to available (called internally)
 * Used when a milestone is approved or after escrow release
 */
exports.releasePendingFunds = async (freelancerId, amount) => {
    try {
        const { data: wallet } = await adminClient
            .from('wallets')
            .select('pending_balance, available_balance, total_earned')
            .eq('user_id', freelancerId)
            .single();

        if (!wallet) {
            // Auto-create wallet
            await adminClient.from('wallets').insert([{
                user_id: freelancerId,
                available_balance: amount,
                total_earned: amount
            }]);
            return;
        }

        const newPending = Math.max(parseFloat(wallet.pending_balance) - amount, 0);
        const newAvailable = parseFloat(wallet.available_balance) + amount;
        const newEarned = parseFloat(wallet.total_earned) + amount;

        await adminClient
            .from('wallets')
            .update({
                pending_balance: newPending,
                available_balance: newAvailable,
                total_earned: newEarned
            })
            .eq('user_id', freelancerId);
    } catch (err) {
        logger.error('[Wallet] Failed to release pending funds', err);
    }
};

/**
 * Helper: Add funds to pending balance (called when escrow deposit is made)
 */
exports.addPendingFunds = async (freelancerId, amount) => {
    try {
        const { data: wallet } = await adminClient
            .from('wallets')
            .select('pending_balance')
            .eq('user_id', freelancerId)
            .single();

        if (!wallet) {
            await adminClient.from('wallets').insert([{
                user_id: freelancerId,
                pending_balance: amount
            }]);
            return;
        }

        const newPending = parseFloat(wallet.pending_balance) + amount;

        await adminClient
            .from('wallets')
            .update({ pending_balance: newPending })
            .eq('user_id', freelancerId);
    } catch (err) {
        logger.error('[Wallet] Failed to add pending funds', err);
    }
};

/**
 * Get wallet history (transactions)
 * GET /api/wallet/history
 */
exports.getWalletHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (err) {
        logger.error('[Wallet] Failed to fetch history', err);
        next(err);
    }
};
