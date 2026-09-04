const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const authMiddleware = require('../middleware/authMiddleware');
const actingUser = require('../middleware/actingUser');

router.use(authMiddleware, actingUser);

router.get('/', driverController.getDrivers);
router.post('/', driverController.createDriver);
router.get('/:id', driverController.getDriver);
router.put('/:id', driverController.updateDriver);
router.post('/:id/deactivate', driverController.deactivateDriver);
router.delete('/:id', driverController.deleteDriver);

module.exports = router;
