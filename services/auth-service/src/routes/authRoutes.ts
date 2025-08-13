import { Router, Request, Response } from 'express';
import {
  sendMagicLink,
  verifyMagicLink,
  refreshToken,
  logout,
  logoutAll,
  revokeSession,
  getUsersCollection,
  completeOnboarding,
} from '../controllers/authController.js';
import {
  listMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from '../controllers/menuController.js';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoriesController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  magicLinkSchema,
  menuItemSchema,
  menuItemUpdateSchema,
  categorySchema,
  categoryUpdateSchema,
} from '../validation/schemas.js';
import { ObjectId } from 'mongodb';

const router: Router = Router();

// Magic link
router.post('/magic-link', validateRequest(magicLinkSchema), sendMagicLink);
router.get('/magic-link/verify', verifyMagicLink);

// Tokens/logout
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);

// Complete onboarding (protected)
router.post('/onboarding/complete', authenticateJWT, completeOnboarding);

// Menu items (protected; POST for update/delete per your current setup)
router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);
router.post('/menu-items/:id/update', authenticateJWT, validateRequest(menuItemUpdateSchema), updateMenuItem);
router.post('/menu-items/:id/delete', authenticateJWT, deleteMenuItem);

// Categories (protected; POST for update/delete)
router.get('/categories', authenticateJWT, listCategories);
router.post('/categories', authenticateJWT, validateRequest(categorySchema), createCategory);
router.post('/categories/:id/update', authenticateJWT, validateRequest(categoryUpdateSchema), updateCategory);
router.post('/categories/:id/delete', authenticateJWT, deleteCategory);

// Sessions management (protected)
router.post('/logout-all', authenticateJWT, logoutAll);
router.post('/revoke-session', authenticateJWT, revokeSession);

// List sessions (protected)
router.get('/sessions', authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const collection = await getUsersCollection();
  const user = await collection.findOne({ _id: new ObjectId(userId) });
  if (!user) return res.status(404).json({ message: 'User not found' });

  res.json({
    sessions: (user.refreshTokens || []).map((t: any) => ({
      tokenId: t.tokenId,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      userAgent: t.userAgent,
      ip: t.ip,
    })),
  });
});

// Me (protected)
router.get('/me', authenticateJWT, async (req: Request, res: Response) => {
  const collection = await getUsersCollection();
  const user = await collection.findOne({ _id: new ObjectId((req as any).user.id) });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user });
});

export default router;