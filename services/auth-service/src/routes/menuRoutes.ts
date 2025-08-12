/**
 * Menu routes (per-user)
 * - GET /api/v1/auth/menu-items
 * - POST /api/v1/auth/menu-items
 */
import express from 'express';
import { listMenuItems, createMenuItem } from '../controllers/menuController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { menuItemSchema } from '../validation/schemas.js';

const router: express.Router = express.Router();

// Per-user menu items (protected)
router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);

export default router;