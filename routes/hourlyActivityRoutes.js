const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const h = require('../controllers/hourlyActivityController');

router.use(protect);

// Timesheets
router.get('/timesheets', h.getTimesheets);
router.post('/timesheets', authorize('FREELANCER'), h.getOrCreateTimesheet);
router.patch('/timesheets/:id/status', authorize('CLIENT'), h.updateTimesheetStatus);

// Work diary
router.get('/work-diary', h.getWorkDiary);
router.post('/work-diary', authorize('FREELANCER'), h.addWorkDiaryEntry);
router.delete('/work-diary/:id', authorize('FREELANCER'), h.deleteWorkDiaryEntry);

// Time by freelancer (client view)
router.get('/time-by-freelancer', authorize('CLIENT'), h.getTimeByFreelancer);

// Custom export
router.get('/export', h.exportActivity);

module.exports = router;
