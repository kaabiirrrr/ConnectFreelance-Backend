const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAdmin, authorizeAdmin } = require('../middleware/adminAuthMiddleware');
const idv = require('../controllers/identityVerificationController');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1 * 1024 * 1024 } // 1MB max
});

// User routes
router.get('/status', protect, idv.getVerificationStatus);
router.post('/submit', protect, idv.submitVerification);
router.post('/upload', protect, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err?.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File size must be under 1MB. Please compress your image and try again.' });
        }
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    });
}, idv.uploadDocument);

// Admin routes — use admin auth middleware
router.get('/admin/pending', protectAdmin, idv.getPendingVerifications);
router.patch('/admin/:id/review', protectAdmin, idv.reviewVerification);

module.exports = router;
