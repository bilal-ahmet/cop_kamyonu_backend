const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const authMiddleware = require('../middleware/authMiddleware');
const verifyVehicleOwnership = require('../middleware/vehicleOwnership');

router.use(authMiddleware);

router.get('/', vehicleController.getVehicles);
router.post('/', vehicleController.createVehicle);

// :id alan tüm alt endpointlerde sahiplik doğrulaması
router.use('/:id', verifyVehicleOwnership);

router.put('/:id', vehicleController.updateVehicle);
router.delete('/:id', vehicleController.deactivateVehicle);
router.get('/:id/location', vehicleController.getVehicleLocation);
router.get('/:id/summary', vehicleController.getVehicleSummary);
router.get('/:id/telemetry', vehicleController.getVehicleTelemetry);
router.get('/:id/sensors', vehicleController.getVehicleSensors);
router.get('/:id/waypoints', vehicleController.getVehicleWaypoints);
router.post('/:id/waypoints', vehicleController.createWaypoint);
router.put('/:id/waypoints/:waypointId', vehicleController.updateWaypoint);
router.delete('/:id/waypoints/:waypointId', vehicleController.deleteWaypoint);

module.exports = router;
