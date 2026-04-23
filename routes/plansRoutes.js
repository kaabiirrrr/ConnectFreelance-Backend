const express = require('express');
const router = express.Router();
const plansController = require('../controllers/admin/plansController');
const { protectAdmin, authorizeAdmin, ADMIN_ROLES } = require('../middleware/adminAuthMiddleware');

// Public route to get plans for the membership page (published only)
router.get('/', plansController.getPlans);

// Protected Admin Routes (Only Super Admin can create, edit, delete)
router.get('/admin/all', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN), plansController.getAllPlansAdmin);
router.post('/create', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), plansController.createPlan);
router.patch('/:id/toggle-publish', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), plansController.togglePublish);
router.put('/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), plansController.updatePlan);
router.delete('/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), plansController.deletePlan);

module.exports = router;
