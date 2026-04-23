const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const callLogController = require('../controllers/callLogController');

router.use(protect);

router.get('/', callLogController.getCallLogs);
router.get('/:conversationId', callLogController.getConversationCallLogs);

module.exports = router;
