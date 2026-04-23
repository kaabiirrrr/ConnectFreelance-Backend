const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, resetPasswordSchema } = require('../schemas/userSchema');
const { protect } = require('../middleware/authMiddleware');

const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);
router.post('/logout', authController.logout);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), authController.resetPassword);

router.get('/google', authController.googleLogin);
router.get('/apple', authController.appleLogin);
router.get('/facebook', authController.facebookLogin);

// Protected routes
router.get('/verify-session', protect, authController.verifySession);
router.post('/sync-oauth', protect, authLimiter, authController.syncOAuthUser);
router.post('/sync', protect, authLimiter, authController.syncOAuthUser); 
router.post('/send-verification', protect, authLimiter, authController.sendVerification);
router.get('/verify-email', authController.verifyEmail);
router.put('/update-role', protect, authController.updateRole);
router.post('/mark-email-verified', protect, authController.markEmailVerified);

module.exports = router;
