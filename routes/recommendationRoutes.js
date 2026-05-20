const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    getRecommendations,
    trackEvent,
    getProfileAIScore,
    triggerCompute,
    getConnectCost
} = require('../controllers/recommendationController');

// All routes require authentication
router.use(protect);

// GET /api/recommendations — personalized job feed for freelancer
router.get('/', authorize('FREELANCER'), getRecommendations);

// POST /api/recommendations/event — behavioral signal tracking
router.post('/event', authorize('FREELANCER'), trackEvent);

// GET /api/recommendations/profile-ai-score — AI readiness score
router.get('/profile-ai-score', authorize('FREELANCER'), getProfileAIScore);

// GET /api/recommendations/connect-cost/:jobId — dynamic connect cost
router.get('/connect-cost/:jobId', authorize('FREELANCER'), getConnectCost);

// POST /api/recommendations/compute — trigger background compute (admin or self)
router.post('/compute', triggerCompute);

module.exports = router;
