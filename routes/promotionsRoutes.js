const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const p = require('../controllers/promotionsController');

router.use(protect, authorize('FREELANCER'));

router.get('/my', p.getMyPromotions);
router.get('/stats', p.getPromotionStats);
router.patch('/:type', p.togglePromotion);

module.exports = router;
