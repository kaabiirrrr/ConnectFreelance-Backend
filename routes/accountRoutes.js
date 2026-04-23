const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/health', accountController.getHealthStatus);
router.get('/enforcement-history', accountController.getEnforcementHistory);
router.get('/onboarding-status', accountController.getOnboardingStatus);
router.post('/send-verification', accountController.sendVerificationEmail);

// Security Settings
router.get('/security', accountController.getSecuritySettings);
router.put('/security', accountController.updateSecuritySettings);

// Notification Settings
router.get('/notifications', accountController.getNotificationSettings);
router.put('/notifications', accountController.updateNotificationSettings);

module.exports = router;
