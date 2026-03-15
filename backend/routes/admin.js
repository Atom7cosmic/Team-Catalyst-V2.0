const express = require('express');
const router = express.Router();
const { adminController } = require('../controllers');
const { authMiddleware, adminMiddleware } = require('../middleware');

router.use(authMiddleware);
router.use(adminMiddleware);

// Admin routes
router.get('/users', adminController.getAllUsers);
router.put('/users/:id/status', adminController.toggleUserStatus);
router.get('/prompts', adminController.getPromptTemplates);
router.put('/prompts/:id', adminController.updatePromptTemplate);
router.get('/system-stats', adminController.getSystemStats);
router.post('/impersonate', adminController.impersonateUser);
router.post('/users', adminController.createUser);

module.exports = router;
