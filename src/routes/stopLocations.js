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
router.delete('/:id', stopLocationController.deactivateStopLocation);

module.exports = router;
