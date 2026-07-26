const express = require('express');
const router = express.Router();
const assignmentController = require('../controllers/assignmentController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', assignmentController.getAssignments);
router.post('/', assignmentController.createAssignment);
router.get('/:id', assignmentController.getAssignment);
router.put('/:id', assignmentController.updateAssignment);
router.post('/:id/end', assignmentController.endAssignment);
router.delete('/:id', assignmentController.deleteAssignment);

module.exports = router;
