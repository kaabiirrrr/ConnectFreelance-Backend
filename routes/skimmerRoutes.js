const express = require('express');
const router = express.Router();
const skimmerController = require('../controllers/skimmerController');
const { protect } = require('../middleware/authMiddleware');

/**
 * Skimmer Co-Pilot Routes
 * Base: /api/skimmer
 */

router.use(protect);

router.get('/:jobId/overview', skimmerController.getProjectOverview);
router.get('/:jobId/tasks', skimmerController.getProjectTasks);
router.get('/:jobId/insights', skimmerController.getAIInsights);
router.get('/:jobId/history', skimmerController.getHealthHistory);

// Client-only regenerate
router.post('/:jobId/regenerate-plan', skimmerController.regeneratePlan);

module.exports = router;
