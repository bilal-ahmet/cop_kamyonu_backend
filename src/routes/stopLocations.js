const express = require('express');
const router = express.Router();
const stopLocationController = require('../controllers/stopLocationController');
const authMiddleware = require('../middleware/authMiddleware');
const stopLocationOwnership = require('../middleware/stopLocationOwnership');

router.use(authMiddleware);

router.post('/', stopLocationController.createStopLocation);

router.use('/:id', stopLocationOwnership);
router.get('/:id', stopLocationController.getStopLocation);
router.put('/:id', stopLocationController.updateStopLocation);
router.post('/:id/deactivate', stopLocationController.deactivateStopLocation);
router.delete('/:id', stopLocationController.deleteStopLocation);

module.exports = router;
