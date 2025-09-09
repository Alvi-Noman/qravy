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
import { validateRequest } from '../middleware/validateRequest.js';
import {
  menuItemSchema,
  menuItemUpdateSchema,
  bulkAvailabilitySchema,
  bulkDeleteSchema,
  bulkCategorySchema,
} from '../validation/schemas.js';

const router: express.Router = express.Router();

router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);
router.post('/menu-items/:id/update', authenticateJWT, validateRequest(menuItemUpdateSchema), updateMenuItem);
router.post('/menu-items/:id/delete', authenticateJWT, deleteMenuItem);

router.post(
  '/menu-items/bulk/availability',
  authenticateJWT,
  validateRequest(bulkAvailabilitySchema),
  bulkSetAvailability
);
router.post('/menu-items/bulk/delete', authenticateJWT, validateRequest(bulkDeleteSchema), bulkDeleteMenuItems);
router.post('/menu-items/bulk/category', authenticateJWT, validateRequest(bulkCategorySchema), bulkChangeCategory);

export default router;