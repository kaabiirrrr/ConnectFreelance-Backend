const express = require('express');
const router = express.Router();
const membershipController = require('../controllers/membershipController');
const { protect } = require('../middleware/authMiddleware');

/**
 * All membership routes are protected
 */
router.use(protect);

router.get('/plans', membershipController.getPlans);
router.get('/current', protect, membershipController.getCurrentMembership);
router.post('/create-order', protect, membershipController.createOrder);
router.post('/verify', protect, membershipController.verifyPayment);

module.exports = router;
