/**
 * Access Routes
 * Handles tenant access settings, device registration, and admin invitations.
 */

import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import accessController from '../controllers/accessController.js';

const router: Router = Router();

/**
 * Access settings (for owners/admins)
 */
router.get('/settings', authenticateJWT, accessController.getAccessSettings);
router.put('/settings', authenticateJWT, accessController.updateAccessSettings);

/**
 * Device management
 */
router.get('/devices', authenticateJWT, accessController.listDevices);
router.post('/devices/register', authenticateJWT, accessController.registerOrAssignDevice);
router.get('/devices/lookup', authenticateJWT, accessController.lookupDeviceByKey);

/**
 * Tenant / workspace selection
 */
router.get('/workspaces', authenticateJWT, accessController.listAccessibleWorkspaces);
router.post('/select-tenant', authenticateJWT, accessController.selectTenant);

/**
 * Admin team listing (owner/admins)
 */
router.get('/admins', authenticateJWT, accessController.listAdmins);

/**
 * Admin Invitations
 * - invite-admin: send a new invite
 * - resend-invite: resend existing invite
 * - revoke-admin: revoke invite or remove admin
 * - confirm-invite: public endpoint (from email link)
 */
router.post('/invite-admin', authenticateJWT, accessController.inviteAdmin);
router.post('/resend-invite', authenticateJWT, accessController.resendInvite);
router.post('/revoke-admin', authenticateJWT, accessController.revokeAdmin);
router.get('/confirm-invite', accessController.confirmInvite);

export default router;
