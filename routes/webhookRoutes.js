const express = require('express');
const router = express.Router();
const razorpayWebhookController = require('../controllers/razorpayWebhookController');

/**
 * PUBLIC WEBHOOK ENDPOINT
 * Note: Signature is verified internally in the controller
 */
router.post('/razorpay', razorpayWebhookController.handleWebhook);

module.exports = router;
