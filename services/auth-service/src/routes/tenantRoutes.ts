import express from 'express';
import type { Router as RouterType } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { tenantCreateSchema } from '../validation/schemas.js';
import { createTenant, getMyTenant, saveOnboardingStep } from '../controllers/tenantController.js';

const router: RouterType = express.Router();

// Tenant routes
router.post('/tenants', authenticateJWT, validateRequest(tenantCreateSchema), createTenant);
router.get('/tenants/me', authenticateJWT, getMyTenant);
router.post('/tenants/onboarding-step', authenticateJWT, saveOnboardingStep);

export default router;