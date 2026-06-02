const express = require('express');
const router = express.Router();
const sensorController = require('../controllers/sensorController');
const authMiddleware = require('../middleware/authMiddleware');
const sensorOwnership = require('../middleware/sensorOwnership');

router.use(authMiddleware);

router.post('/', sensorController.createSensor);

router.use('/:id', sensorOwnership);
router.get('/:id', sensorController.getSensor);
router.put('/:id', sensorController.updateSensor);
router.delete('/:id', sensorController.deactivateSensor);

module.exports = router;
