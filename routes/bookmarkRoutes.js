const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/bookmarkController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { toggleBookmarkSchema } = require('../schemas/bookmarkSchema');

router.use(protect);

// Toggle bookmark on/off — POST /api/bookmarks/toggle
router.post('/toggle', validate(toggleBookmarkSchema), bookmarkController.toggleBookmark);

// Get all bookmarked jobs (paginated, full data) — GET /api/bookmarks
router.get('/', bookmarkController.getBookmarks);

// Check if a specific job is bookmarked — GET /api/bookmarks/check/:jobId
router.get('/check/:jobId', bookmarkController.checkBookmark);

// Get all saved job IDs (for bulk icon highlighting) — GET /api/bookmarks/ids
router.get('/ids', bookmarkController.getSavedJobIds);

// Get saved jobs with full job data (for Saved Jobs tab) — GET /api/bookmarks/saved-jobs
router.get('/saved-jobs', bookmarkController.getSavedJobs);

module.exports = router;

