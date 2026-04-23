const express = require('express');
const router = express.Router();
const milestoneController = require('../controllers/milestoneController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { createMilestoneSchema, updateMilestoneStatusSchema } = require('../schemas/milestoneSchema');

router.use(protect);

// Create milestone (client only — validated inside controller)
router.post('/create', validate(createMilestoneSchema), milestoneController.createMilestone);

// Update milestone status (role validated inside controller based on transition)
router.patch('/:id/status', validate(updateMilestoneStatusSchema), milestoneController.updateStatus);

// Get all milestones for a contract (participant only)
router.get('/contract/:contractId', milestoneController.getContractMilestones);

module.exports = router;
