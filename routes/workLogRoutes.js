const express = require('express');
const router = express.Router();
const workLogController = require('../controllers/workLogController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Freelancer routes
router.post('/', workLogController.upsertWorkLog);

// Shared / Role-specific routes
router.get('/job/:jobId', workLogController.getJobLogs);
router.get('/client/summary', workLogController.getClientSummary);
router.post('/ask', workLogController.askForWorkUpdate);
router.get('/queries', workLogController.getFreelancerQueries);

module.exports = router;
