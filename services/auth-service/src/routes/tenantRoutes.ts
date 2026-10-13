import express from 'express';
import type { Router as RouterType } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { denyBranchSession } from '../middleware/scope.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { tenantCreateSchema, tenantUpdateSchema } from '../validation/schemas.js';
import {
  createTenant,
  checkSubdomainAvailability,
  getMyTenant,
  saveOnboardingStep,
  updateMyTenant,
  endTrialEarly,
  subscribeTenant,
  cancelSubscription,
  setPaymentMethodMeta,
  clearPaymentMethod,
  getBillingProfile,
  saveBillingProfile,
} from '../controllers/tenantController.js';

const router: RouterType = express.Router();

// Tenant routes
router.post('/tenants', authenticateJWT, validateRequest(tenantCreateSchema), createTenant);
router.get('/tenants/subdomain-check', authenticateJWT, checkSubdomainAvailability);
router.get('/tenants/me', authenticateJWT, getMyTenant);
router.put('/tenants/me', authenticateJWT, denyBranchSession, validateRequest(tenantUpdateSchema), updateMyTenant);
router.post('/tenants/onboarding-step', authenticateJWT, denyBranchSession, saveOnboardingStep);

router.post('/tenants/trial/end', authenticateJWT, denyBranchSession, endTrialEarly);
router.post('/tenants/subscribe', authenticateJWT, denyBranchSession, subscribeTenant);
router.post('/tenants/cancel', authenticateJWT, denyBranchSession, cancelSubscription);

// Payment method metadata (non-sensitive)
router.post('/tenants/payment-method', authenticateJWT, denyBranchSession, setPaymentMethodMeta);
router.delete('/tenants/payment-method', authenticateJWT, denyBranchSession, clearPaymentMethod);

// Billing profile (address/info)
router.get('/tenants/billing-profile', authenticateJWT, getBillingProfile);
router.post('/tenants/billing-profile', authenticateJWT, denyBranchSession, saveBillingProfile);

export default router;