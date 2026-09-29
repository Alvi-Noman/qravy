import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  orderCreateSchema,
  orderEtaUpdateSchema,
  orderStatusUpdateSchema,
  publicOrderCreateSchema,
  publicWaitTimeSchema,
} from '../validation/schemas.js';
import {
  adjustOrderEta,
  createOrder,
  getPublicOrder,
  listOrders,
  placePublicOrder,
  publicWaitTime,
  streamOrders,
  streamPublicOrder,
  updateOrderStatus,
} from '../controllers/ordersController.js';

const router: Router = Router();

/* ---------- guest (no login; keyed by restaurant subdomain + table, tracked by a private token) ---------- */
router.post('/public/orders', validateRequest(publicOrderCreateSchema), placePublicOrder);
router.get('/public/orders/:token', getPublicOrder);
router.get('/public/orders/:token/stream', streamPublicOrder);
router.post('/public/wait-time', validateRequest(publicWaitTimeSchema), publicWaitTime);

/* ---------- restaurant staff ---------- */
// live board (Server-Sent Events; the admin reads it with fetch so the token stays in the Authorization header)
router.get('/orders/stream', authenticateJWT, applyScope, authorize('orders:read'), streamOrders);
router.get('/orders', authenticateJWT, applyScope, authorize('orders:read'), listOrders);
router.post('/orders', authenticateJWT, applyScope, authorize('orders:create'), validateRequest(orderCreateSchema), createOrder);
router.post(
  '/orders/:id/status',
  authenticateJWT,
  applyScope,
  authorize('orders:update'),
  validateRequest(orderStatusUpdateSchema),
  updateOrderStatus,
);
router.post(
  '/orders/:id/eta',
  authenticateJWT,
  applyScope,
  authorize('orders:update'),
  validateRequest(orderEtaUpdateSchema),
  adjustOrderEta,
);

export default router;
