const express = require('express');
const router = express.Router();
const userProblemController = require('../controllers/userProblemController');

// Submit a problem publicly
router.post('/submit', userProblemController.submitProblem);

module.exports = router;
