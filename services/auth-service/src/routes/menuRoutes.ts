// services/auth-service/src/routes/menuRoutes.ts
/**
 * Menu routes (per-user)
 * - GET /api/v1/auth/menu-items
 * - POST /api/v1/auth/menu-items
 * - POST /api/v1/auth/menu-items/:id/update
 * - POST /api/v1/auth/menu-items/:id/delete
 */
import express from 'express';
import { listMenuItems, createMenuItem, updateMenuItem, deleteMenuItem } from '../controllers/menuController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { menuItemSchema, menuItemUpdateSchema } from '../validation/schemas.js';

const router: express.Router = express.Router();

router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);
router.post('/menu-items/:id/update', authenticateJWT, validateRequest(menuItemUpdateSchema), updateMenuItem);
router.post('/menu-items/:id/delete', authenticateJWT, deleteMenuItem);

export default router;