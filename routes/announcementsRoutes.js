const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/admin/announcementsController');
const { protect } = require('../middleware/authMiddleware');
const { protectAdmin, authorizeAdmin, ADMIN_ROLES } = require('../middleware/adminAuthMiddleware');

// ─── PUBLIC ──────────────────────────────────────────────────────────────────
// Active announcement for dashboards (no auth required)
router.get('/active', ctrl.getActiveAnnouncement);

// Log user engagement (requires any authenticated user token)
router.post('/log', protect, ctrl.logAction);

// ─── ADMIN ───────────────────────────────────────────────────────────────────
// Analytics (admin readable)
router.get('/admin/analytics', protectAdmin, ctrl.getAnalytics);

// Get all (admin readable)
router.get('/admin/all', protectAdmin, ctrl.getAllAnnouncements);

// SUPER_ADMIN only — create, update, delete
router.post('/admin/create', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), ctrl.createAnnouncement);
router.patch('/admin/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), ctrl.updateAnnouncement);
router.delete('/admin/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), ctrl.deleteAnnouncement);

module.exports = router;
