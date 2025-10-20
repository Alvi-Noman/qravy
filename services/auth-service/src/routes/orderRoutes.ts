import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { createOrder, createOrderValidators } from '../controllers/ordersController.js';

const router: Router = Router();

// POST /api/v1/orders
router.post(
  '/orders',
  authenticateJWT,
  applyScope,
  // If you don't have this capability yet, temporarily remove the next line:
  authorize('orders:create'),
  ...createOrderValidators,
  createOrder
);

export default router;
