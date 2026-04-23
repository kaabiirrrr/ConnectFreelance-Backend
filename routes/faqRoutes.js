const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');

// Public FAQ routes
router.post('/submit', faqController.submitQuestion);
router.get('/published', faqController.getPublishedFAQs);

module.exports = router;
