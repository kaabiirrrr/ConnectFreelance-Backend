const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect); // All subscription routes require auth

router.post('/create', subscriptionController.createSubscription);
router.get('/status', subscriptionController.getSubscriptionStatus);
router.post('/cancel', subscriptionController.cancelSubscription);

module.exports = router;
