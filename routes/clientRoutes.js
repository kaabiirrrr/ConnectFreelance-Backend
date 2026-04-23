const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const clientSavedFreelancersController = require('../controllers/clientSavedFreelancersController');

// Authenticated CLIENT only — saved freelancers / talent
router.get(
    '/saved-freelancers',
    protect,
    authorize('CLIENT'),
    clientSavedFreelancersController.listSavedFreelancers
);
router.post(
    '/saved-freelancers',
    protect,
    authorize('CLIENT'),
    clientSavedFreelancersController.saveFreelancer
);
router.delete(
    '/saved-freelancers/:freelancerId',
    protect,
    authorize('CLIENT'),
    clientSavedFreelancersController.removeSavedFreelancer
);

module.exports = router;
