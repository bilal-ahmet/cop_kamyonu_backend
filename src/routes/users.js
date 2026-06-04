const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');

router.use(authMiddleware);

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.get('/', requireAdmin, userController.getUsers);
router.post('/', requireAdmin, userController.createUser);

module.exports = router;
