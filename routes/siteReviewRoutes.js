const express = require('express');
const router = express.Router();
const siteReviewController = require('../controllers/siteReviewController');

// Public routes — no auth required
router.get('/', siteReviewController.getReviews);
router.post('/', siteReviewController.addReview);

module.exports = router;
