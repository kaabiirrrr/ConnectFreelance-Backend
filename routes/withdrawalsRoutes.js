const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAdmin } = require('../middleware/adminAuthMiddleware');
const w = require('../controllers/withdrawalsController');
const { financialBackpressure } = require('../utils/dbUtils');


// Freelancer routes
router.get('/', protect, authorize('FREELANCER'), w.getWithdrawals);
router.post('/', protect, authorize('FREELANCER'), w.requestWithdrawal);
router.patch('/:id/cancel', protect, authorize('FREELANCER'), w.cancelWithdrawal);

// Admin routes
router.get('/admin/list', protectAdmin, w.adminGetWithdrawals);
router.patch('/admin/:id/process', protectAdmin, financialBackpressure, w.adminProcessWithdrawal);


module.exports = router;
