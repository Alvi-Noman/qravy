import express from 'express';
import type { Router as RouterType } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { tenantCreateSchema } from '../validation/schemas.js';
import {
  createTenant,
  getMyTenant,
  saveOnboardingStep,
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
router.get('/tenants/me', authenticateJWT, getMyTenant);
router.post('/tenants/onboarding-step', authenticateJWT, saveOnboardingStep);

router.post('/tenants/trial/end', authenticateJWT, endTrialEarly);
router.post('/tenants/subscribe', authenticateJWT, subscribeTenant);
router.post('/tenants/cancel', authenticateJWT, cancelSubscription);

// Payment method metadata (non-sensitive)
router.post('/tenants/payment-method', authenticateJWT, setPaymentMethodMeta);
router.delete('/tenants/payment-method', authenticateJWT, clearPaymentMethod);

// Billing profile (address/info)
router.get('/tenants/billing-profile', authenticateJWT, getBillingProfile);
router.post('/tenants/billing-profile', authenticateJWT, saveBillingProfile);

export default router;