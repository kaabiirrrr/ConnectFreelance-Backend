const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { isUserOnline } = require('../socket/index');

router.use(protect);

// GET /api/presence/online — get all currently online user IDs
router.get('/online', (req, res) => {
    const { getOnlineUsers } = require('../socket/index');
    res.json({ success: true, data: { onlineUsers: getOnlineUsers() } });
});

// GET /api/presence/:userId — check if a specific user is online
router.get('/:userId', (req, res) => {
    const { userId } = req.params;
    res.json({ success: true, data: { online: isUserOnline(userId) } });
});

module.exports = router;
