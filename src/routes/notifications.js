const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Sabit yollar, /:id kalıplarından ÖNCE tanımlanmalı — aksi halde "read-all" bir id sanılır.
router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.put('/read-all', notificationController.markAllRead);

router.put('/:id/read', notificationController.markRead);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
