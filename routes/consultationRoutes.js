const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/consultationController');

router.get('/experts', c.getExperts); // public

router.use(protect);
router.get('/', c.getMyConsultations);
router.post('/', c.bookConsultation);
router.patch('/:id/status', c.updateConsultationStatus);

module.exports = router;
