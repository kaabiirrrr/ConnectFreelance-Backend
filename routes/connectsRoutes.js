const express = require('express');
const router = express.Router();
const { 
    getBalance, 
    getHistory, 
    getPackages, 
    applyPromoCode, 
    createPaymentIntent,
    confirmPayment,
    getSettings
} = require('../controllers/connectsController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect); // Require authentication for all connects routes
router.use(authorize('FREELANCER', 'CLIENT'));

router.get('/balance', getBalance);
router.get('/history', getHistory);
router.get('/packages', getPackages);
router.post('/apply-promo', applyPromoCode);
router.post('/create-payment-intent', createPaymentIntent);
router.post('/confirm-payment', confirmPayment);
router.get('/settings', getSettings);

module.exports = router;
