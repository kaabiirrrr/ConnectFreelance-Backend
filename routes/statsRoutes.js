const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { protectOptional } = require('../middleware/authMiddleware');

// Public endpoint for global platform stats
router.get('/global', protectOptional, statsController.getGlobalStats);

module.exports = router;
