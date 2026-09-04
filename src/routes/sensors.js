const express = require('express');
const router = express.Router();
const sensorController = require('../controllers/sensorController');
const authMiddleware = require('../middleware/authMiddleware');
const actingUser = require('../middleware/actingUser');
const sensorOwnership = require('../middleware/sensorOwnership');

router.use(authMiddleware, actingUser);

router.post('/', sensorController.createSensor);

router.use('/:id', sensorOwnership);
router.get('/:id', sensorController.getSensor);
router.put('/:id', sensorController.updateSensor);
router.post('/:id/deactivate', sensorController.deactivateSensor);
router.delete('/:id', sensorController.deleteSensor);

module.exports = router;
