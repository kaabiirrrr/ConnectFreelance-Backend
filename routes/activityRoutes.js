const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { protect } = require('../middleware/authMiddleware');

// Public tracking (handles both guest and authenticated logs)
router.post('/track', (req, res, next) => {
    // Optional Auth: If token present, we try to protect, else we proceed as guest
    if (req.headers.authorization) {
        return protect(req, res, next);
    }
    next();
}, activityController.trackEvent);

module.exports = router;
