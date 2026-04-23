const express = require('express');
const router = express.Router();
const fakeEscrowController = require('../controllers/fakeEscrowController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/fund', fakeEscrowController.fundEscrow);
router.post('/release', fakeEscrowController.releaseEscrow);
router.post('/reset', fakeEscrowController.resetWallet);
router.get('/balance', fakeEscrowController.getBalance);
router.get('/transactions', fakeEscrowController.getTransactions);

module.exports = router;
