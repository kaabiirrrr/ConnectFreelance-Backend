const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { createReviewSchema } = require('../schemas/reviewSchema');

// Public: view reviews for any user
router.get('/user/:id', reviewController.getUserReviews);

// Protected: create a review (must be contract participant)
router.post('/create', protect, validate(createReviewSchema), reviewController.createReview);

// Protected: get reviews for a specific contract
router.get('/contract/:contract_id', protect, reviewController.getContractReviews);

module.exports = router;
