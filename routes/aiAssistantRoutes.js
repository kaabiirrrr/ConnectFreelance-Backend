const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    generateJobPost,
    improveJobPost,
    suggestSkills,
    generateProposal,
    optimizeProfile,
    bidStrategy,
    chat,
    optimizeMission
} = require('../controllers/aiAssistantController');

// Quick health check (no auth) — test with: GET /api/ai/ping
router.get('/ping', (req, res) => res.json({ success: true, message: 'AI route is alive' }));

// All routes below require authentication
router.use(protect);

// Client routes
router.post('/generate-job', generateJobPost);
router.post('/improve-job', improveJobPost);
router.post('/suggest-skills', suggestSkills);
router.post('/optimize-mission', optimizeMission);

// Freelancer routes
router.post('/generate-proposal', generateProposal);
router.post('/optimize-profile', optimizeProfile);
router.post('/bid-strategy', bidStrategy);

// Shared
router.post('/chat', chat);

module.exports = router;
