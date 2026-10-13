import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { publicServiceRequestSchema, serviceRequestStatusSchema } from '../validation/schemas.js';
import {
  createServiceRequest,
  getPublicServiceRequest,
  listServiceRequests,
  updateServiceRequestStatus,
} from '../controllers/serviceRequestsController.js';

const router: Router = Router();

/* ---------- guest at a table ("Call waiter"; no login, by restaurant subdomain + table) ---------- */
router.post('/public/service-requests', validateRequest(publicServiceRequestSchema), createServiceRequest);
router.get('/public/service-requests/:token', getPublicServiceRequest);

/* ---------- restaurant staff (whoever runs the orders board answers the calls; live via /orders/stream) ---------- */
router.get('/service-requests', authenticateJWT, applyScope, authorize('orders:read'), listServiceRequests);
router.post(
  '/service-requests/:id/status',
  authenticateJWT,
  applyScope,
  authorize('orders:update'),
  validateRequest(serviceRequestStatusSchema),
  updateServiceRequestStatus,
);

export default router;
