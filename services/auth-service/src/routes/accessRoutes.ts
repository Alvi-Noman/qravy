import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import accessController from '../controllers/accessController.js';

const router: Router = Router();

router.get('/settings', authenticateJWT, accessController.getAccessSettings);
router.put('/settings', authenticateJWT, accessController.updateAccessSettings);

router.get('/devices', authenticateJWT, accessController.listDevices);
router.post('/devices/register', authenticateJWT, accessController.registerOrAssignDevice);
router.get('/devices/lookup', authenticateJWT, accessController.lookupDeviceByKey); // NEW

router.get('/workspaces', authenticateJWT, accessController.listAccessibleWorkspaces);
router.post('/select-tenant', authenticateJWT, accessController.selectTenant);

export default router;