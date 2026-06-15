const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Cache yenilemesi güvenlik gerektirdiği için auth kullanıyoruz
router.use(authMiddleware);

router.post('/refresh-cache', adminController.refreshCache);
router.post('/run-summary', adminController.runDailySummary);

module.exports = router;