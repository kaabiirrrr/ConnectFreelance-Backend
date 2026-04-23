const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/bankAccountController');

router.use(protect);
router.get('/', ctrl.getAccounts);
router.post('/', ctrl.addAccount);
router.delete('/:id', ctrl.deleteAccount);
router.patch('/:id/default', ctrl.setDefault);

module.exports = router;
