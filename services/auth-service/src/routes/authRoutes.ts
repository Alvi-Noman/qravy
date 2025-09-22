import { Router, type Request, type Response } from 'express';
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
import { client } from '../db.js';

const router: Router = Router();

// Magic link
router.post('/magic-link', validateRequest(magicLinkSchema), sendMagicLink);
router.get('/magic-link/verify', verifyMagicLink);
router.get('/verify-magic-link', verifyMagicLink);

// Tokens/logout
router.options('/refresh-token', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,authorization');
  res.sendStatus(204);
});
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);

// Complete onboarding (protected)
router.post('/onboarding/complete', authenticateJWT, completeOnboarding);

// Menu items
router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);
router.post('/menu-items/:id/update', authenticateJWT, validateRequest(menuItemUpdateSchema), updateMenuItem);
router.post('/menu-items/:id/delete', authenticateJWT, deleteMenuItem);

// Categories
router.get('/categories', authenticateJWT, listCategories);
router.post('/categories', authenticateJWT, validateRequest(categorySchema), createCategory);
router.post('/categories/:id/update', authenticateJWT, validateRequest(categoryUpdateSchema), updateCategory);
router.post('/categories/:id/delete', authenticateJWT, deleteCategory);

// Sessions
router.post('/logout-all', authenticateJWT, logoutAll);
router.post('/revoke-session', authenticateJWT, revokeSession);

// Sessions list
router.get('/sessions', authenticateJWT, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.fail(401, 'Unauthorized');
  const collection = await getUsersCollection();
  const user = await collection.findOne({ _id: new ObjectId(userId) });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const sessions = (user.refreshTokens ?? []).map((t) => ({
    tokenId: t.tokenId,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    userAgent: t.userAgent,
    ip: t.ip,
  }));
  return res.ok({ sessions });
});

// Me (derived isOnboarded) - uses DB tenantId or falls back to JWT tenantId
router.get('/me', authenticateJWT, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.fail(401, 'Unauthorized');

  const collection = await getUsersCollection();
  const user = await collection.findOne({ _id: new ObjectId(userId) });
  if (!user) return res.status(404).json({ message: 'User not found' });

  let effectiveTenantId: ObjectId | null = null;

  if (user.tenantId) {
    effectiveTenantId = user.tenantId;
  } else if (req.user?.tenantId && ObjectId.isValid(req.user.tenantId)) {
    effectiveTenantId = new ObjectId(req.user.tenantId);
  }

  let isOnboarded = false;
  let tenantIdStr: string | null = null;

  if (effectiveTenantId) {
    tenantIdStr = effectiveTenantId.toString();
    const tenant = await client.db('authDB').collection('tenants').findOne({ _id: effectiveTenantId });
    if (tenant?.onboardingCompleted) isOnboarded = true;
  }

  const isCentral = !req.user?.role;
  const locationId = req.user?.locationId ?? null;

  return res.ok({
    user: {
      id: user._id?.toString() || '',
      email: user.email,
      isVerified: !!user.isVerified,
      tenantId: tenantIdStr,
      isOnboarded,
    },
    session: {
      type: isCentral ? 'central' : 'member',
      locationId,
    },
  });
});

export default router;