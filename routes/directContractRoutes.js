const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const dc = require('../controllers/directContractController');

router.use(protect);

router.post('/', authorize('CLIENT'), dc.createDirectContract);
router.get('/', dc.listDirectContracts);
router.get('/:id', dc.getDirectContract);
router.patch('/:id/status', dc.updateDirectContractStatus);

module.exports = router;
