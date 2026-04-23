const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', menuController.getSubmenus);
router.post('/', protect, menuController.addSubmenu);

module.exports = router;
