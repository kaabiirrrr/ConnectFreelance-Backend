const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const reports = require('../controllers/reportsController');

router.use(protect);

router.get('/weekly-summary', reports.getWeeklySummary);
router.get('/transactions', reports.getTransactionHistory);
router.get('/spending-by-activity', reports.getSpendingByActivity);

module.exports = router;
