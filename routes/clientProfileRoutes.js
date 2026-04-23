const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');

// Grouped under /api/client as per server.js
// So these are /api/client/profile
router.get('/profile', protect, profileController.getClientProfile);
router.post('/profile', protect, profileController.updateClientProfile);
router.put('/profile', protect, profileController.updateClientProfile);
router.post('/profile/photo', protect, profileController.avatarUpload.single('photo'), profileController.uploadClientPhoto);

module.exports = router;
