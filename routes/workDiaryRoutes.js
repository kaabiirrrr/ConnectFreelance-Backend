const express = require('express');
const router = express.Router();
const workDiaryController = require('../controllers/workDiaryController');
const { protect } = require('../middleware/authMiddleware');

/**
 * @route   POST /api/work-diary
 * @desc    Log a new work entry
 * @access  Private (Freelancer)
 */
router.post('/', protect, workDiaryController.logWork);

/**
 * @route   GET /api/work-diary
 * @desc    Get entries for a contract
 * @access  Private (Client/Freelancer)
 */
router.get('/', protect, workDiaryController.getWorkDiary);

/**
 * @route   DELETE /api/work-diary/:id
 * @desc    Delete a pending work entry
 * @access  Private (Freelancer)
 */
router.delete('/:id', protect, workDiaryController.deleteWorkEntry);

module.exports = router;
