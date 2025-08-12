/**
 * Auth + Menu routes
 * - Magic link
 * - Refresh/logout/session
 * - Me (DTO)
 * - Complete onboarding
 * - Per-user menu items (list, create)
 */
import express from 'express';
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
import { listMenuItems, createMenuItem } from '../controllers/menuController.js';
  // JWT + validation
import { authenticateJWT } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { magicLinkSchema, menuItemSchema } from '../validation/schemas.js';
import { ObjectId } from 'mongodb';
import { toUserDTO } from '../utils/mapper.js';

const router: express.Router = express.Router();

// Magic link
router.post('/magic-link', validateRequest(magicLinkSchema), sendMagicLink);
router.get('/magic-link/verify', verifyMagicLink);

// Tokens/logout
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);

// Complete onboarding (protected)
router.post('/onboarding/complete', authenticateJWT, completeOnboarding);

// Per-user menu items (protected)
router.get('/menu-items', authenticateJWT, listMenuItems);
router.post('/menu-items', authenticateJWT, validateRequest(menuItemSchema), createMenuItem);

// Sessions management (protected)
router.post('/logout-all', authenticateJWT, logoutAll);
router.post('/revoke-session', authenticateJWT, revokeSession);

// List sessions (protected)
router.get('/sessions', authenticateJWT, async (req, res) => {
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

// Me (protected) — return DTO (sanitized)
router.get('/me', authenticateJWT, async (req, res) => {
  const collection = await getUsersCollection();
  const user = await collection.findOne({ _id: new ObjectId((req as any).user.id) });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: toUserDTO(user) });
});

export default router;