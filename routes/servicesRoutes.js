const express = require('express');
const router = express.Router();
const { protect, protectOptional, authorize } = require('../middleware/authMiddleware');
const s = require('../controllers/servicesController');

// Static paths FIRST — before /:id wildcard
router.get('/orders/my', protect, s.getMyOrders);
router.patch('/orders/:id/status', protect, s.updateOrderStatus);
router.get('/my/list', protect, authorize('FREELANCER'), s.getMyServices);

// Public
router.get('/', protectOptional, s.getServices);
router.get('/:id', protectOptional, s.getServiceById);

// Protected
router.use(protect);
router.post('/upload', authorize('FREELANCER'), s.serviceUpload.single('file'), s.uploadServiceImage);
router.post('/', authorize('FREELANCER'), s.createService);
router.patch('/:id', authorize('FREELANCER'), s.updateService);
router.delete('/:id', authorize('FREELANCER'), s.deleteService);

// Orders
router.post('/:id/order', protect, authorize('CLIENT'), s.placeOrder);

module.exports = router;
