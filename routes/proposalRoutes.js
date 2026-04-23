const express = require('express');
const router = express.Router();
const proposalController = require('../controllers/proposalController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { submitProposalSchema, updateProposalStatusSchema } = require('../schemas/proposalSchema');

router.use(protect);

// Freelancer routes
router.post('/create', authorize('FREELANCER'), validate(submitProposalSchema), proposalController.submitProposal);
router.get('/check/:jobId', authorize('FREELANCER'), proposalController.checkProposal);
router.delete('/:id', authorize('FREELANCER'), proposalController.withdrawProposal);

// Client routes
router.get('/client/pending', authorize('CLIENT'), proposalController.getClientPendingProposals);
router.get('/job/:jobId', authorize('CLIENT'), proposalController.getJobProposals);
router.put('/:id/accept', authorize('CLIENT'), proposalController.acceptProposal);
router.patch('/:id/status', authorize('CLIENT'), validate(updateProposalStatusSchema), proposalController.updateProposalStatus);

// Shared
router.get('/', proposalController.getMyProposals);
router.get('/:id/match', proposalController.getProposalMatch);

module.exports = router;

