console.log('[File Load] profileRoutes.js loaded');
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.get('/freelancers', profileController.getAllFreelancers);
router.get('/verify/email/confirm', profileController.confirmEmailByLink); // redirect link

// Protected routes
router.get('/me', protect, profileController.getMe);
router.patch('/update', protect, profileController.updateProfile);
router.get('/status', (req, res, next) => {
    console.log('[Route Debug] Hit /api/profile/status route - triggering protect middleware');
    next();
}, protect, profileController.getProfileStatus);
router.get('/stats', protect, profileController.getFreelancerStats);
router.put('/status', protect, profileController.updateProfileStatus);
router.post('/verify/email/send', protect, profileController.sendVerificationEmail);
router.post('/delete-account/send-otp', protect, profileController.sendDeleteAccountOTP);
router.delete('/delete-account', protect, profileController.deleteAccount);

// Upload routes BEFORE dynamic /:id to avoid conflicts
router.post('/upload-avatar', protect, profileController.avatarUpload.single('avatar'), profileController.uploadAvatar);
router.post('/upload-document', protect, profileController.documentUpload.single('document'), profileController.uploadDocument);
router.post('/upload-portfolio', protect, profileController.portfolioUpload.single('file'), profileController.uploadPortfolioItem);

// Dynamic route LAST
router.get('/:id', profileController.getPublicProfile);

module.exports = router;
