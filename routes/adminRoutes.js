const express = require('express');
const router = express.Router();

const adminAuthController = require('../controllers/admin/adminAuthController');
const admin2FAController = require('../controllers/admin/admin2FAController');
const adminAnalyticsController = require('../controllers/admin/adminAnalyticsController');
const announcementsController = require('../controllers/admin/announcementsController');
const adminUserController = require('../controllers/admin/adminUserController');
const adminJobController = require('../controllers/admin/adminJobController');
const adminProposalController = require('../controllers/admin/adminProposalController');
const adminContractController = require('../controllers/admin/adminContractController');
const adminPaymentController = require('../controllers/admin/adminPaymentController');
const adminDisputeController = require('../controllers/admin/adminDisputeController');
const adminModerationController = require('../controllers/admin/adminModerationController');
const adminVerificationController = require('../controllers/admin/adminVerificationController');
const adminAuditController = require('../controllers/admin/adminAuditController');
const adminGeneralController = require('../controllers/admin/adminGeneralController');
const adminManagementController = require('../controllers/admin/adminManagementController');
const adminFinanceController = require('../controllers/admin/adminFinanceController');
const adminProblemController = require('../controllers/admin/adminProblemController');
const adminFaqController = require('../controllers/admin/adminFaqController');
const adminReviewController = require('../controllers/admin/adminReviewController');
const adminNotificationController = require('../controllers/admin/adminNotificationController');
const adminLotteryController = require('../controllers/admin/adminLotteryController');
const adminConnectsController = require('../controllers/admin/adminConnectsController');


const { ADMIN_ROLES, authorizeAdmin, protectAdmin } = require('../middleware/adminAuthMiddleware');

// ==========================================
// Auth Routes
// ==========================================
router.post('/login', adminAuthController.login);
router.post('/logout', protectAdmin, adminAuthController.logout);
router.get('/profile', protectAdmin, adminAuthController.getProfile);
router.put('/profile', protectAdmin, adminAuthController.updateProfile);
router.post('/profile/avatar', protectAdmin, adminAuthController.avatarUpload.single('avatar'), adminAuthController.uploadAvatar);

// ==========================================
// Two-Factor Authentication (2FA) Routes
// ==========================================
router.post('/2fa/setup', protectAdmin, admin2FAController.setup2FA);
router.post('/2fa/verify', protectAdmin, admin2FAController.verifyAndEnable2FA);
router.post('/2fa/disable', protectAdmin, admin2FAController.disable2FA);
router.post('/2fa/verify-login', admin2FAController.verify2FALogin);

// ==========================================
// Admin Management (SUPER_ADMIN ONLY)
// ==========================================
router.get('/admins', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminManagementController.getAllAdmins);
router.post('/add-admin', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminManagementController.addAdmin);
router.delete('/admins/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminManagementController.removeAdmin);
router.put('/admins/:id/role', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminManagementController.updateAdminRole);

// ==========================================
// Admin Activity Logs (SUPER_ADMIN ONLY)
// ==========================================
router.get('/admin-logs', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminAuditController.getLogs);

// New: Production audit logs (from admin_audit_logs table)
const auditLogController = require('../controllers/auditLogController');
router.get('/logs', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), auditLogController.getAuditLogs);
router.get('/logs/summary', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), auditLogController.getLogsSummary);

// Dashboard Analytics Routes
// ==========================================
router.get('/analytics/overview', protectAdmin, adminAnalyticsController.getDashboardOverview);
router.get('/analytics/activity', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminAnalyticsController.getAdminActivityStats);

// Announcements analytics (called by OffersPage as /api/admin/announcements/analytics)
router.get('/announcements/analytics', protectAdmin, announcementsController.getAnalytics);

// ==========================================
// User Management & Verification
// ==========================================
router.get('/users', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminUserController.getAllUsers);
router.put('/users/:id/toggle-status', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminUserController.toggleUserStatus);
router.post('/users/:id/reset-password', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminUserController.resetUserPassword);
router.delete('/users/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminUserController.deleteUser);

// Verification routes
router.get('/verification/requests', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminVerificationController.getVerificationRequests);
router.put('/verification/:userId', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminVerificationController.updateVerificationStatus);
router.put('/freelancers/:userId/featured', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminVerificationController.toggleFeaturedStatus);

// ==========================================
// Finance & Withdrawals
// ==========================================
const withdrawalsController = require('../controllers/withdrawalsController');

router.get('/withdrawals', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), withdrawalsController.adminGetWithdrawals);
router.put('/withdrawals/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), withdrawalsController.adminProcessWithdrawal);
router.get('/settings/platform', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminFinanceController.getPlatformSettings);
router.put('/settings/commission', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminFinanceController.updateCommission);

// ==========================================
// Skills & Announcements
// ==========================================
router.post('/skills', protectAdmin, adminGeneralController.addSkill);
router.delete('/skills/:id', protectAdmin, adminGeneralController.deleteSkill);
router.post('/announcements', protectAdmin, adminGeneralController.createAnnouncement);
router.get('/announcements', protectAdmin, adminGeneralController.getAnnouncements);

// ==========================================
// Fraud Monitoring
// ==========================================
router.get('/fraud/suspicious-users', protectAdmin, adminGeneralController.getSuspiciousUsers);

// ==========================================
// Job & Contract Management
// ==========================================
router.get('/jobs', protectAdmin, adminJobController.getAllJobs);
router.put('/jobs/:id/approve', protectAdmin, adminJobController.approveJob);
router.put('/jobs/:id/reject', protectAdmin, adminJobController.rejectJob);
router.delete('/jobs/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminJobController.removeJob);

router.get('/proposals', protectAdmin, adminProposalController.getAllProposals);
router.delete('/proposals/:id', protectAdmin, adminProposalController.removeProposal);

router.get('/contracts', protectAdmin, adminContractController.getAllContracts);
router.put('/contracts/:id/cancel', protectAdmin, adminContractController.cancelContract);

// ==========================================
// Payments, Disputes, Reports, Notifications
// ==========================================
// Payment Management
router.get('/payments', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminPaymentController.getAllPayments);

// Disputes & Reports
router.get('/disputes', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminDisputeController.getAllDisputes);
router.put('/disputes/:id/resolve', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminDisputeController.resolveDispute);
router.get('/reports', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminModerationController.getAllReports);
router.put('/reports/:id/resolve', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminModerationController.resolveReport);

// AI Moderation & Enforcement (v2)
router.get('/moderation/violations', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminModerationController.getViolations);
router.get('/moderation/offenders', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminModerationController.getRepeatOffenders);
router.post('/moderation/enforce/:userId', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminModerationController.enforceAction);


// Broadcast Notifications
router.post('/notifications/send', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminNotificationController.sendAnnouncement);

// User Problem Management
router.get('/problems', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminProblemController.getProblems);
router.patch('/problems/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminProblemController.updateProblemStatus);
router.delete('/problems/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminProblemController.deleteProblem);

// FAQ Management
router.get('/faqs', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminFaqController.getAllFAQs);
router.patch('/faqs/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminFaqController.updateFAQ);
router.delete('/faqs/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminFaqController.deleteFAQ);

// Review Management
router.get('/reviews/project', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminReviewController.getProjectReviews);
router.get('/reviews/site', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminReviewController.getSiteReviews);
router.delete('/reviews/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminReviewController.deleteReview);

// ==========================================
// Lottery Management
// ==========================================
router.get('/lottery/draws', protectAdmin, adminLotteryController.getDraws);
router.post('/lottery/draws', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminLotteryController.createDraw);
router.post('/lottery/draws/:id/run', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminLotteryController.runLottery);
router.get('/lottery/draws/:id/winners', protectAdmin, adminLotteryController.getWinners);
router.delete('/lottery/draws/:id', protectAdmin, authorizeAdmin(ADMIN_ROLES.SUPER_ADMIN), adminLotteryController.deleteDraw);

// ==========================================
// Connect Economy Management
// ==========================================
router.get('/connects/settings', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.FINANCE_ADMIN), adminConnectsController.getSettings);
router.put('/connects/settings', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN), adminConnectsController.updateSettings);
router.get('/connects/analytics', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.FINANCE_ADMIN), adminConnectsController.getEconomyAnalytics);
router.get('/connects/ledger', protectAdmin, authorizeAdmin(ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.FINANCE_ADMIN), adminConnectsController.getAuditLedger);

module.exports = router;
