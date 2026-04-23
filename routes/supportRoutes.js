const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { protectAdmin } = require('../middleware/adminAuthMiddleware');
const { protect } = require('../middleware/authMiddleware');

// Submit a support ticket
router.post('/create', supportController.createTicket);

// Get user ticket history
router.get('/my-tickets', supportController.getUserTickets);

// Get messages for a ticket (User or Admin)
router.get('/ticket/:id/messages', protect, supportController.getTicketMessages);

// --- Admin Endpoints ---
router.get('/admin/all-tickets', protectAdmin, supportController.getAllTickets);
router.get('/admin/ticket/:id', protectAdmin, supportController.getTicketDetails);
router.patch('/admin/assign/:id', protectAdmin, supportController.assignTicket);
router.patch('/admin/update-status/:id', protectAdmin, supportController.updateTicketStatus);
router.post('/admin/message', protectAdmin, supportController.addTicketMessage);

module.exports = router;
