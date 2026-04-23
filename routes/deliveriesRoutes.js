const express = require('express');
const router = express.Router();
const deliveriesController = require('../controllers/deliveriesController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public health check
router.get('/ping', (req, res) => res.json({ success: true, message: 'Deliveries API is alive', timestamp: new Date() }));

// Protected routes below
router.use(protect);

// --- Dual Access Routes (Download & View) ---
router.get('/files/download', deliveriesController.downloadFile);
router.get('/files/signed-url', deliveriesController.getSignedUrl);
router.get('/job/:jobId', deliveriesController.getDeliveriesByJob);
router.post('/:id/comments', deliveriesController.addComment);

// --- Freelancer Routes ---
router.post('/upload-url', authorize('FREELANCER'), deliveriesController.getUploadUrl);
router.post('/', authorize('FREELANCER'), deliveriesController.submitWork);

// --- Client Routes ---
router.post('/:id/approve', authorize('CLIENT'), deliveriesController.approveWork);
router.post('/:id/revision', authorize('CLIENT'), deliveriesController.requestRevision);

module.exports = router;
