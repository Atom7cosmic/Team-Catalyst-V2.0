const express = require('express');
const router = express.Router();
const { adminController } = require('../controllers');
const { authMiddleware } = require('../middleware');

router.use(authMiddleware);
const { requireSuperior } = require('../middleware/roleMiddleware');
router.use((req, res, next) => { if (req.user?.isAdmin) return next(); return requireSuperior(req, res, next); });

// Admin routes
router.get('/users', adminController.getAllUsers);
router.put('/users/:id/status', adminController.toggleUserStatus);
router.get('/prompts', adminController.getPromptTemplates);
router.put('/prompts/:id', adminController.updatePromptTemplate);
router.get('/system-stats', adminController.getSystemStats);
router.post('/impersonate', adminController.impersonateUser);
router.post('/users', adminController.createUser);

module.exports = router;
