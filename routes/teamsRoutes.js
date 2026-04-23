const express = require('express');
const router = express.Router();
const teamsController = require('../controllers/teamsController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/create', authorize('CLIENT'), teamsController.createTeam);
router.get('/my-teams', authorize('CLIENT'), teamsController.getMyTeams);
router.post('/invite', authorize('CLIENT'), teamsController.inviteMember);
router.get('/:team_id/members', teamsController.getMembers);
router.delete('/remove-member', authorize('CLIENT'), teamsController.removeMember);

module.exports = router;
