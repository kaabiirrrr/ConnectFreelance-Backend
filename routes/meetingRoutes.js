const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const m = require('../controllers/meetingController');

router.use(protect);

router.get('/', m.getMyMeetings);
router.post('/', m.createMeeting);
router.get('/join/:roomCode', m.getMeetingByCode);
router.get('/:id/token', m.getMeetingToken);      // JaaS JWT — call before loading Jitsi
router.get('/:id', m.getMeetingById);
router.post('/:id/start', m.startMeeting);
router.post('/:id/end', m.endMeeting);
router.post('/:id/invite', m.inviteParticipant);
router.post('/:id/recording/start', m.startRecording);
router.post('/:id/recording/stop', m.stopRecording);
router.get('/:id/recording/status', m.getRecordingStatus);

module.exports = router;
