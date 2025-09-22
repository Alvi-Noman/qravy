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
} from '../controllers/menuController.js';
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
} from '../validation/schemas.js';

const router: express.Router = express.Router();

router.get('/menu-items', authenticateJWT, applyScope, authorize('menuItems:read'), listMenuItems);

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