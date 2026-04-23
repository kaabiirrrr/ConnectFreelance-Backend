const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const convController = require('../controllers/conversationController');
const multer = require('multer');
const supabase = require('../supabase/client');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

router.use(protect);

// Conversations
router.get('/', convController.getMyConversations);
router.get('/requests', convController.getConversationRequests);   // pending requests inbox
router.post('/', convController.getOrCreateConversation);

// Static sub-paths BEFORE dynamic /:conversationId
router.get('/blocked', convController.getBlockList);
router.get('/block-status/:userId', convController.getBlockStatus);
router.post('/block/:userId', convController.blockUser);
router.delete('/unblock/:userId', convController.unblockUser);
router.post('/report/:userId', convController.reportUser);

router.get('/:conversationId/messages', convController.getMessages);
router.post('/:conversationId/accept', convController.acceptConversationRequest);
router.post('/:conversationId/reject', convController.rejectConversationRequest);
router.post('/:conversationId/mute', convController.muteConversation);
router.delete('/:conversationId/mute', convController.unmuteConversation);
router.get('/:conversationId/mute-status', convController.getMuteStatus);
router.delete('/:conversationId/clear', convController.clearConversation);


// File upload for chat
router.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'zip', 'txt'];
        if (!allowed.includes(ext)) {
            return res.status(400).json({ success: false, message: 'File type not allowed' });
        }

        const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
        const filePath = `uploads/${req.user.id}/${fileName}`;

        const { error } = await supabase.storage
            .from('chat-attachments')
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
            .from('chat-attachments')
            .getPublicUrl(filePath);

        const messageType = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? 'image' : 'document';

        res.status(200).json({
            success: true,
            data: { url: publicUrl, name: req.file.originalname, type: messageType }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
