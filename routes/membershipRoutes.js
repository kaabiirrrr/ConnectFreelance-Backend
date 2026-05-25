const express = require('express');
const router = express.Router();
const membershipController = require('../controllers/membershipController');
const { protect } = require('../middleware/authMiddleware');

router.get('/plans', membershipController.getPlans);

/**
 * All membership routes are protected
 */
router.use(protect);
router.get('/current', protect, membershipController.getCurrentMembership);
router.post('/create-order', protect, membershipController.createOrder);
router.post('/verify', protect, membershipController.verifyPayment);
router.post('/sales-proposal', protect, membershipController.createSalesProposal);
router.get('/my-proposals', protect, membershipController.getMyProposals);
router.post('/create-custom-order', protect, membershipController.createCustomOrder);
router.post('/verify-custom', protect, membershipController.verifyCustomPayment);

module.exports = router;
