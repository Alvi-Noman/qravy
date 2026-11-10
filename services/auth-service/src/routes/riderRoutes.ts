import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { orderRiderSchema, orderTripSchema, riderCreateSchema, riderTripSchema, riderUpdateSchema } from '../validation/schemas.js';
import {
  deleteRider,
  getRiderPage,
  getRiders,
  patchRider,
  postOrderRider,
  postOrderTrip,
  postResetRiderLink,
  postRider,
  postRiderTrip,
  postSettleCash,
  streamRiderPage,
} from '../controllers/ridersController.js';

const router: Router = Router();

/* ---------- the rider's page — no login, their private link is the key ---------- */
router.get('/public/rider/:token', getRiderPage);
router.get('/public/rider/:token/stream', streamRiderPage);
router.post('/public/rider/:token/orders/:orderId', validateRequest(riderTripSchema), postRiderTrip);

/* ---------- restaurant staff (the same rights as the order board) ---------- */
const read = [authenticateJWT, applyScope, authorize('orders:read')];
const write = [authenticateJWT, applyScope, authorize('orders:update')];
router.get('/riders', ...read, getRiders);
router.post('/riders', ...write, validateRequest(riderCreateSchema), postRider);
router.patch('/riders/:id', ...write, validateRequest(riderUpdateSchema), patchRider);
router.delete('/riders/:id', ...write, deleteRider);
router.post('/riders/:id/reset-link', ...write, postResetRiderLink);
router.post('/riders/:id/settle-cash', ...write, postSettleCash);
router.post('/orders/:id/rider', ...write, validateRequest(orderRiderSchema), postOrderRider);
router.post('/orders/:id/trip', ...write, validateRequest(orderTripSchema), postOrderTrip);

export default router;
