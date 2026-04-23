const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const accountHealthController = require('../controllers/freelancerAccountHealthController');

// All endpoints accessible only by freelancers
router.use(protect);
router.use(authorize('FREELANCER', 'SUPER_ADMIN', 'ADMIN'));

// GET Status
router.get('/account-health/status', accountHealthController.getHealthStatus);

// GET Score
router.get('/account-health/score', accountHealthController.getHealthScore);

// GET Violations & History
router.get('/account-health/violations', accountHealthController.getViolations);

// GET Policies List (All)
router.get('/policies', accountHealthController.getPolicies);

// GET Single Policy by slug
router.get('/policies/:slug', accountHealthController.getPolicyBySlug);

// GET Best Practices
router.get('/best-practices', accountHealthController.getBestPractices);

// GET Success Roadmap
router.get('/success-roadmap', accountHealthController.getSuccessRoadmap);

// POST Appeal Validation
router.post('/appeal-violation', accountHealthController.submitAppeal);

module.exports = router;
