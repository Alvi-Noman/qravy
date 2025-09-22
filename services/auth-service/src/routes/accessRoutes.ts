import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import accessController from '../controllers/accessController.js';

const router: Router = Router();

// Access settings (per-tenant)
router.get('/settings', authenticateJWT, accessController.getAccessSettings);
router.put('/settings', authenticateJWT, accessController.updateAccessSettings);

// Devices
router.get('/devices', authenticateJWT, accessController.listDevices);
router.post('/devices/register', authenticateJWT, accessController.registerOrAssignDevice);

// Workspaces visible to the current email (central-access flow)
router.get('/workspaces', authenticateJWT, accessController.listAccessibleWorkspaces);

// Select a tenant and receive a tenant-bound access token
router.post('/select-tenant', authenticateJWT, accessController.selectTenant);

export default router;