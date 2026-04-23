const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { withdrawSchema } = require('../schemas/walletSchema');

router.use(protect);

// Get wallet balance (auto-creates wallet if first visit)
router.get('/', walletController.getWallet);

// Withdraw funds from available balance (Freelancers only)
router.post('/withdraw', authorize('FREELANCER'), validate(withdrawSchema), walletController.withdraw);

// Top-up wallet (Clients only)
router.post('/topup/create', authorize('CLIENT'), walletController.createTopupOrder);
router.post('/topup/verify', authorize('CLIENT'), walletController.verifyTopup);

// Wallet Transaction History
router.get('/history', walletController.getWalletHistory);

module.exports = router;
