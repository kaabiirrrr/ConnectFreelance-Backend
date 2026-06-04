const express = require('express');
const router = express.Router();
const otpActionController = require('../controllers/otpActionController');
const { protect } = require('../middleware/authMiddleware');

router.post('/send', protect, otpActionController.sendOTP);
router.post('/verify', protect, otpActionController.verifyOTP);

module.exports = router;
