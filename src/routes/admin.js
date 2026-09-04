const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');

// Cache yenileme ve özet hesaplama tüm filoyu etkiler — yalnızca admin.
router.use(authMiddleware, requireAdmin);

router.post('/refresh-cache', adminController.refreshCache);
router.post('/run-summary', adminController.runDailySummary);

module.exports = router;
