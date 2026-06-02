const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.get('/', userController.getUsers);
router.post('/', userController.createUser);

module.exports = router;
