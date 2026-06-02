const express = require('express');
const router = express.Router();
const telemetryController = require('../controllers/telemetryController');

router.post('/', telemetryController.receiveTelemetry);

module.exports = router;
