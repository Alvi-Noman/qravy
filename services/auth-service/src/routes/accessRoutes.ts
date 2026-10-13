/**
 * Access Routes
 * Handles tenant access settings, device registration, and admin invitations.
 */

import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { denyBranchSession } from '../middleware/scope.js';
import accessController from '../controllers/accessController.js';

const router: Router = Router();

/**
 * Access settings (for owners/admins)
 */
router.get('/settings', authenticateJWT, accessController.getAccessSettings);
router.put('/settings', authenticateJWT, denyBranchSession, accessController.updateAccessSettings);

/**
 * Device management
 */
router.get('/devices', authenticateJWT, denyBranchSession, accessController.listDevices);
router.post('/devices/register', authenticateJWT, accessController.registerOrAssignDevice);
router.get('/devices/lookup', authenticateJWT, accessController.lookupDeviceByKey);
// move a device to another branch / forget it — owners and admins, not from a branch device
router.patch('/devices/:id', authenticateJWT, denyBranchSession, accessController.updateDevice);
// the owner's / an admin's way out when their own device was set to a branch (allowed from that branch device)
router.delete('/devices/current', authenticateJWT, accessController.releaseCurrentDevice);
router.delete('/devices/:id', authenticateJWT, denyBranchSession, accessController.deleteDevice);

/**
 * Tenant / workspace selection
 */
router.get('/workspaces', authenticateJWT, accessController.listAccessibleWorkspaces);
router.post('/select-tenant', authenticateJWT, accessController.selectTenant);

/**
 * Admin team listing (owner/admins)
 */
router.get('/admins', authenticateJWT, denyBranchSession, accessController.listAdmins);

/**
 * Admin Invitations
 * - invite-admin: send a new invite
 * - resend-invite: resend existing invite
 * - revoke-admin: revoke invite or remove admin
 * - confirm-invite: public endpoint (from email link)
 */
router.post('/invite-admin', authenticateJWT, denyBranchSession, accessController.inviteAdmin);
router.post('/resend-invite', authenticateJWT, denyBranchSession, accessController.resendInvite);
router.post('/revoke-admin', authenticateJWT, denyBranchSession, accessController.revokeAdmin);
router.get('/confirm-invite', accessController.confirmInvite);

export default router;
