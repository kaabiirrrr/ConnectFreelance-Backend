const express = require('express');
const router = express.Router();
const interventionController = require('../controllers/interventionController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.get('/active', protect, interventionController.getActiveInterventions);
router.get('/stats', protect, authorize('ADMIN', 'SUPER_ADMIN'), interventionController.getInterventionStats);
router.post('/:id/resolve', protect, interventionController.resolveIntervention);

module.exports = router;
