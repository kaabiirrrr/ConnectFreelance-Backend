const express = require('express');
const router = express.Router();
const relationshipController = require('../controllers/relationshipController');
const { protect } = require('../middleware/authMiddleware');

/**
 * Trust Graph v2 Routes
 * Root: /api/relationship
 */

router.get('/stats/:freelancerId', protect, relationshipController.getRelationshipStats);

module.exports = router;
