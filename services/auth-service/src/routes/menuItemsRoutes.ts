/**
 * Menu routes (per-user)
 */
import express from 'express';
import {
  listMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  bulkSetAvailability,
  bulkDeleteMenuItems,
  bulkChangeCategory,
} from '../controllers/menuItemsController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { applyScope } from '../middleware/scope.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  menuItemSchema,
  menuItemUpdateSchema,
  bulkAvailabilitySchema,
  bulkDeleteSchema,
  bulkCategorySchema,
  listMenuItemsQuerySchema,
} from '../validation/schemas.js';

const router: express.Router = express.Router();

// Inline query validator (since validateRequest expects 1 arg)
const validateListQuery: express.RequestHandler = (req, res, next) => {
  const parsed = listMenuItemsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'Invalid query params';
    return res.fail(400, msg);
  }
  next();
};

router.get(
  '/menu-items',
  authenticateJWT,
  applyScope,
  authorize('menuItems:read'),
  validateListQuery,
  listMenuItems
);

router.post(
  '/menu-items',
  authenticateJWT,
  applyScope,
  authorize('menuItems:create'),
  validateRequest(menuItemSchema),
  createMenuItem
);

router.post(
  '/menu-items/:id/update',
  authenticateJWT,
  applyScope,
  authorize('menuItems:update'),
  validateRequest(menuItemUpdateSchema),
  updateMenuItem
);

router.post(
  '/menu-items/:id/delete',
  authenticateJWT,
  applyScope,
  authorize('menuItems:delete'),
  // Validate optional ?locationId=&channel= for scoped delete
  validateListQuery,
  deleteMenuItem
);

router.post(
  '/menu-items/bulk/availability',
  authenticateJWT,
  applyScope,
  authorize('menuItems:toggleAvailability'),
  validateRequest(bulkAvailabilitySchema),
  bulkSetAvailability
);

router.post(
  '/menu-items/bulk/delete',
  authenticateJWT,
  applyScope,
  authorize('menuItems:delete'),
  // bulkDeleteSchema should accept { ids, locationId?, channel? }
  validateRequest(bulkDeleteSchema),
  bulkDeleteMenuItems
);

router.post(
  '/menu-items/bulk/category',
  authenticateJWT,
  applyScope,
  authorize('menuItems:update'),
  validateRequest(bulkCategorySchema),
  bulkChangeCategory
);

export default router;
