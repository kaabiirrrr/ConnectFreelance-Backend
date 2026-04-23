const express = require('express');
const router = express.Router();
const jobsController = require('../controllers/jobsController');
const { getJobDeadlineRisk } = require('../services/deadlineRiskService');
const { protect, authorize, protectOptional } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { createJobSchema, updateJobSchema } = require('../schemas/jobSchema');

// Public routes (specific paths first)
router.get('/recent', jobsController.getRecentJobs);
router.get('/all', jobsController.getAllJobs);
router.get('/stats', jobsController.getJobFilterStats);

// Live search — GET /api/jobs/search?q=<query>
router.get('/search', jobsController.searchJobs);

// ─── Protected routes (specific named paths before parameterized) ─────────────
router.get('/find-work', protect, jobsController.findWork);
router.get('/best-matches/:freelancerId', protect, jobsController.getBestMatches);
router.get('/client/my-jobs', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.getClientJobs);
router.get('/client/dashboard', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.getDashboardSummary);
router.post('/', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), validate({ body: createJobSchema }), jobsController.createJob);
router.post('/:id/save', protect, authorize('FREELANCER'), jobsController.toggleSaveJob);
router.put('/update/:id', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), validate({ body: createJobSchema.partial() }), jobsController.updateJob);
router.patch('/update/:id', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), validate({ body: createJobSchema.partial() }), jobsController.updateJob);
router.delete('/delete/:id', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.deleteJob);
router.patch('/:id/bidding/close', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.closeJobBidding);


// Workspace Management
router.get('/:id/workspace', protect, jobsController.getWorkspaceData);
router.patch('/:id/member/:memberId/role', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.updateJobMember);
router.delete('/:id/member/:memberId', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), jobsController.removeJobMember);

// ─── Parameterized route LAST to avoid catching named routes ──────────────────
router.get('/:id/deadline-risk', protect, authorize('CLIENT', 'ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
    try {
        const result = await getJobDeadlineRisk(req.params.id);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

router.get('/:id', protectOptional, jobsController.getJobById);
module.exports = router;

