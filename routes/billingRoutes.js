const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const billing = require('../controllers/billingController');

router.use(protect);

router.get('/methods', billing.getBillingMethods);
router.post('/setup-intent', billing.createSetupIntent);
router.post('/methods', billing.saveBillingMethod);
router.delete('/methods/:id', billing.deleteBillingMethod);
router.patch('/methods/:id/default', billing.setDefaultBillingMethod);

module.exports = router;
