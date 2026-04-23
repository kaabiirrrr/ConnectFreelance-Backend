const Stripe = require('stripe');
const logger = require('../utils/logger');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
    logger.warn('Stripe secret key not found in environment variables. Payments will fail until configured.');
}

const stripe = new Stripe(stripeSecretKey || 'sk_test_placeholder', {
    apiVersion: '2023-10-16', // use the latest or desired API version
});

module.exports = stripe;
