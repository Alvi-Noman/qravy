// services/auth-service/src/routes/customersRoutes.ts
// GET /api/v1/customers?q=&limit=&skip= — the restaurant's online customers (delivery & pickup), newest order first.
// A branch login sees the customers who ordered from its branch, with that branch's orders.
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { listCustomers } from '../services/customers.js';

const router: express.Router = express.Router();

router.get(
  '/customers',
  authenticateJWT,
  applyScope,
  authorize('orders:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId || !ObjectId.isValid(tenantId)) return res.status(409).json({ success: false, message: 'Tenant not set' });
      const loc = req.user?.locationId;
      const result = await listCustomers({
        tenantOid: new ObjectId(tenantId),
        locationId: loc && ObjectId.isValid(loc) ? new ObjectId(loc) : null,
        q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '',
        limit: Number(req.query.limit) || 50,
        skip: Number(req.query.skip) || 0,
      });
      return res.json({ success: true, ...result });
    } catch (e) {
      return next(e);
    }
  }
);

export default router;
