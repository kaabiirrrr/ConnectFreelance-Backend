const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { createIntentSchema, escrowDepositSchema, releaseEscrowSchema, refundEscrowSchema } = require('../schemas/paymentSchema');

// Webhook must use express.raw, which should be configured in server.js before body parsing
router.post('/webhook', paymentController.handleWebhook);

const { financialBackpressure } = require('../utils/dbUtils');

router.use(protect); // Remaining routes require auth

router.get('/history', paymentController.getMyPayments);
router.post('/create-intent', authorize('CLIENT'), validate(createIntentSchema), paymentController.createIntent);
router.post('/escrow-deposit', authorize('CLIENT'), validate(escrowDepositSchema), paymentController.escrowDeposit);
router.post('/release', authorize('CLIENT'), financialBackpressure, validate(releaseEscrowSchema), paymentController.releaseEscrow);

// RAZORPAY ESCROW
router.post('/razorpay/create-escrow', authorize('CLIENT'), paymentController.createRazorpayEscrowOrder);
router.post('/razorpay/verify-escrow', authorize('CLIENT'), paymentController.verifyRazorpayEscrow);

router.post('/refund', validate(refundEscrowSchema), paymentController.refundEscrow);

module.exports = router;
