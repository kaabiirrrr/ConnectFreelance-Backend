const express = require('express');
const router = express.Router();
const lotteryController = require('../controllers/lotteryController');
const adminLotteryController = require('../controllers/admin/adminLotteryController');
const { protect } = require('../middleware/authMiddleware');
const { protectAdmin, authorizeAdmin, ADMIN_ROLES } = require('../middleware/adminAuthMiddleware');

// ==========================================
// User Routes (Accessible at /api/lottery)
// ==========================================
router.get('/my-status', protect, lotteryController.getMyStatus);
router.get('/my-history', protect, lotteryController.getMyHistory);

module.exports = router;
