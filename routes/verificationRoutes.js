const express = require('express');
const router = express.Router();
const verificationController = require('../controllers/verificationController');
const { protect } = require('../middleware/authMiddleware');
const { protectAdmin } = require('../middleware/adminAuthMiddleware');

router.get('/me', protect, verificationController.getMe);
router.post('/extract', protect, verificationController.extract);
router.post('/submit', protect, verificationController.submit);

// Admin routes
router.get('/admin', protectAdmin, verificationController.getAdminVerifications);
router.patch('/admin/:id/approve', protectAdmin, verificationController.approveVerification);
router.patch('/admin/:id/reject', protectAdmin, verificationController.rejectVerification);

module.exports = router;
