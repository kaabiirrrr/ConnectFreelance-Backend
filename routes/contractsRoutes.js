const express = require('express');
const router = express.Router();

const contractsController = require('../controllers/contractsController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { createContractSchema } = require('../schemas/contractSchema');

router.use(protect);

router.post('/create', authorize('CLIENT'), validate(createContractSchema), contractsController.createContract);
router.get('/client/hired', authorize('CLIENT'), contractsController.getHiredFreelancers);
router.get('/user', contractsController.getUserContracts);
router.get('/:id/deadline-risk', authorize('CLIENT', 'ADMIN'), contractsController.getContractDeadlineRisk);
router.get('/', contractsController.getUserContracts);

module.exports = router;