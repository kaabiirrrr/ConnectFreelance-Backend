const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const submissionController = require('../controllers/workSubmissionController');

router.use(protect);

// Freelancers submit work
router.post('/', authorize('FREELANCER'), submissionController.submitWork);

// Both client and freelancer view historical submissions
router.get('/contract/:contractId', submissionController.getContractSubmissions);

// Clients review and update status
router.patch('/:id/status', authorize('CLIENT'), submissionController.updateSubmissionStatus);

module.exports = router;
