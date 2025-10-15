import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Db, Collection, ObjectId } from 'mongodb';
import { config } from 'dotenv';
import { client } from '../db.js';
import { generateRefreshToken, verifyRefreshToken } from '../utils/token.js';
import { sendMagicLinkEmail } from '../utils/email.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import type { UserDoc, RefreshToken } from '../models/User.js';
import { computeCapabilities } from '@muvance/shared/utils/policy';

config();

let db: Db | null = null;

type AccessClaims = { id: string; email: string } & JwtPayload;
type Role = 'owner' | 'admin' | 'editor' | 'viewer';

function isJwtPayloadWithIdEmail(payload: unknown): payload is AccessClaims {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.email === 'string';
}

function userInfo(user: { email?: string; _id?: ObjectId } | null): string {
  const id = user?._id ? user._id.toString() : 'unknown-id';
  const email = user?.email ?? 'unknown-email';
  return `${email} (${id})`;
}

export async function getUsersCollection(): Promise<Collection<UserDoc>> {
  if (!db) {
    db = client.db('authDB');
  }
  if (!db) throw new Error('Database not initialized');
  return db.collection<UserDoc>('users');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupTokens(tokens: RefreshToken[] | undefined): RefreshToken[] {
  const now = new Date();
  return (tokens ?? []).filter((t) => t.expiresAt > now);
}

function generateMagicLinkToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Resolve a user's role (owner/admin/editor/viewer) from tenant ownership or memberships. */
async function resolveUserRoleAndTenantInfo(user: UserDoc): Promise<{
  role: Role | undefined;
  tenantIdStr: string | null;
  isOnboarded: boolean;
}> {
  let tenantIdStr: string | null = null;
  let isOnboarded = false;
  let role: Role | undefined = undefined;

  if (user.tenantId) {
    tenantIdStr = (user.tenantId as ObjectId).toString();

    const tenant = await client
      .db('authDB')
      .collection('tenants')
      .findOne({ _id: user.tenantId as ObjectId });

    isOnboarded = Boolean(tenant?.onboardingCompleted);

    // If this user is the tenant owner
    if (tenant?.ownerId && (tenant.ownerId as ObjectId).toString() === (user._id as ObjectId).toString()) {
      role = 'owner';
    } else {
      // Otherwise use membership role
      const membership = await client
        .db('authDB')
        .collection('memberships')
        .findOne({
          tenantId: user.tenantId as ObjectId,
          userId: user._id as ObjectId,
          status: 'active',
        });

      if (membership && ['owner', 'admin', 'editor', 'viewer'].includes(membership.role)) {
        role = membership.role as Role;
      } else {
        // Safe fallback if they belong to tenant but no explicit role
        role = 'viewer';
      }
    }
  }

  return { role, tenantIdStr, isOnboarded };
}

export const sendMagicLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email: rawEmail } = req.body as { email: string };
    const email = rawEmail.toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      logger.warn(`Invalid email address attempt: ${rawEmail} from IP ${ip}`);
      res.fail(400, 'Invalid email address.');
      return;
    }

    const collection = await getUsersCollection();
    let user = await collection.findOne({ email });

    const magicLinkToken = generateMagicLinkToken();
    const magicLinkTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

    if (!user) {
      const insertResult = await collection.insertOne({
        email,
        isVerified: false,
        refreshTokens: [],
        magicLinkToken,
        magicLinkTokenExpires,
      });
      user = await collection.findOne({ _id: insertResult.insertedId });
      logger.info(`Created new user: ${email} from IP ${ip}`);
    } else {
      await collection.updateOne(
        { _id: user._id as ObjectId },
        { $set: { magicLinkToken, magicLinkTokenExpires } }
      );
      user = await collection.findOne({ _id: user._id as ObjectId });
      logger.info(`Updated magic link for user: ${email} from IP ${ip}`);
    }

    // --- Build magic link base URL safely
    const smtpConfigured =
      !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS && !!process.env.SMTP_FROM;

    const baseUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';
    const magicLink = `${baseUrl.replace(/\/$/, '')}/magic-link?token=${magicLinkToken}`;

    // --- Dev-mode fallback to avoid 500 when SMTP isn't configured
    if (!smtpConfigured && process.env.NODE_ENV !== 'production') {
      logger.warn(`[DEV MODE] SMTP not configured; logging magic link for ${email}: ${magicLink}`);
      res.ok({ message: 'Magic link generated (logged in server, no email in dev).' });
      return;
    }

    logger.info(`Preparing to send magic link to ${email} from IP ${ip}`);

    try {
      await sendMagicLinkEmail(email, magicLink);
      logger.info(`Magic link email sent to ${email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Error sending magic link email to ${email}: ${msg}`);
      res.fail(500, 'Failed to send magic link email.');
      return;
    }

    res.ok({ message: 'Magic link sent. Please check your email.' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`sendMagicLink error: ${msg}`);
    next(error);
  }
};

export const verifyMagicLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token } = req.query;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!token || typeof token !== 'string') {
      logger.warn(`Invalid magic link token received from IP ${ip}`);
      res.fail(400, 'Invalid or expired magic link.');
      return;
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ magicLinkToken: token });

    if (!user || !user.magicLinkTokenExpires || user.magicLinkTokenExpires < new Date()) {
      logger.warn(`Attempt to use invalid or expired magic link from IP ${ip}`);
      res.fail(400, 'Invalid or expired magic link.');
      return;
    }

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { isVerified: true }, $unset: { magicLinkToken: '', magicLinkTokenExpires: '' } }
    );

    // ---- Resolve tenant + role, then compute capabilities
    const { role, tenantIdStr, isOnboarded } = await resolveUserRoleAndTenantInfo(user);

    // Dashboard login ⇒ member session
    const sessionType: 'member' | 'branch' = 'member';

    const capabilities = computeCapabilities({
      role,
      sessionType,
    });

    // ---- Sign access token with role + sessionType (+ tenantId)
    const accessToken = jwt.sign(
      {
        id: (user._id as ObjectId).toString(),
        email: user.email,
        tenantId: tenantIdStr ?? undefined,
        role,
        sessionType,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    // Refresh token (keeps tenantId sticky if present)
    const refreshTokenValue = generateRefreshToken({
      id: (user._id as ObjectId).toString(),
      email: user.email,
      ...(tenantIdStr ? { tenantId: tenantIdStr } : {}),
    });

    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(refreshTokenValue);

    const cleanedTokens = cleanupTokens(user.refreshTokens);

    const userAgent = (req.headers['user-agent'] as string | undefined) || 'unknown';

    cleanedTokens.push({
      tokenId,
      tokenHash,
      createdAt: new Date(),
      expiresAt,
      userAgent,
      ip,
    });

    while (cleanedTokens.length > 5) cleanedTokens.shift();

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { refreshTokens: cleanedTokens } }
    );

    logger.info(`User verified magic link: ${userInfo(user)} from IP ${ip}`);

    res.cookie('refreshToken', refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    // ---- Return user with caps so UI can render correctly
    res.ok({
      token: accessToken,
      user: {
        id: (user._id as ObjectId).toString(),
        email: user.email,
        isVerified: true,
        tenantId: tenantIdStr,
        isOnboarded,
        role,
        sessionType,
        capabilities,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`verifyMagicLink error: ${msg}`);
    next(error);
  }
};

export const completeOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return void res.fail(401, 'Unauthorized');
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    await client
      .db('authDB')
      .collection('tenants')
      .updateOne({ _id: new ObjectId(tenantId) }, { $set: { onboardingCompleted: true, updatedAt: new Date() } });

    logger.info(`Tenant onboarding completed: ${tenantId} by user ${userId}`);
    res.ok({ message: 'Onboarding complete' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`completeOnboarding error: ${msg}`);
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const token = cookies?.refreshToken;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!token) {
      res.fail(401, 'No refresh token provided');
      return;
    }

    let payload: unknown;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.fail(401, 'Invalid or expired refresh token');
      return;
    }

    if (!isJwtPayloadWithIdEmail(payload)) {
      res.fail(401, 'Invalid or expired refresh token');
      return;
    }

    const tenantIdFromRefresh: string | undefined =
      typeof (payload as any).tenantId === 'string' ? (payload as any).tenantId : undefined;

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId((payload as any).id) });
    if (!user) {
      res.fail(401, 'User not found');
      return;
    }

    // Recognize only stored refresh tokens
    const cleanedTokens = cleanupTokens(user.refreshTokens);
    const providedTokenHash = hashToken(token);
    const existingTokenIndex = cleanedTokens.findIndex((t) => t.tokenHash === providedTokenHash);
    if (existingTokenIndex === -1) {
      res.fail(401, 'Refresh token not recognized');
      return;
    }
    cleanedTokens.splice(existingTokenIndex, 1);

    // Issue a new refresh token and keep tenantId sticky
    const newRefreshToken = generateRefreshToken({
      id: (user._id as ObjectId).toString(),
      email: user.email,
      ...(tenantIdFromRefresh ? { tenantId: tenantIdFromRefresh } : {}),
    });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(newRefreshToken);

    const userAgent = (req.headers['user-agent'] as string | undefined) || 'unknown';

    cleanedTokens.push({
      tokenId,
      tokenHash,
      createdAt: new Date(),
      expiresAt,
      userAgent,
      ip,
    });

    while (cleanedTokens.length > 5) cleanedTokens.shift();

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { refreshTokens: cleanedTokens } }
    );

    // Resolve role again (owner/admin/editor/viewer) from tenant/membership
    const { role } = await resolveUserRoleAndTenantInfo(user);
    const sessionType: 'member' | 'branch' = 'member'; // dashboard refresh ⇒ member

    // Access token carries tenantId (from refresh payload or DB), plus role + sessionType
    const newAccessToken = jwt.sign(
      {
        id: (user._id as ObjectId).toString(),
        email: user.email,
        tenantId: tenantIdFromRefresh ?? (user.tenantId ? (user.tenantId as ObjectId).toString() : undefined),
        role,
        sessionType,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.ok({ token: newAccessToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`refreshToken error: ${msg}`);
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const token = cookies?.refreshToken;

    if (!token) {
      res.clearCookie('refreshToken');
      res.ok({ message: 'Logged out' });
      return;
    }

    let payload: unknown;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.clearCookie('refreshToken');
      res.ok({ message: 'Logged out' });
      return;
    }

    if (!isJwtPayloadWithIdEmail(payload)) {
      res.clearCookie('refreshToken');
      res.ok({ message: 'Logged out' });
      return;
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId((payload as any).id) });
    if (!user) {
      res.clearCookie('refreshToken');
      res.ok({ message: 'Logged out' });
      return;
    }

    const providedTokenHash = hashToken(token);
    const cleanedTokens = (user.refreshTokens ?? []).filter((t) => t.tokenHash !== providedTokenHash);

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { refreshTokens: cleanedTokens } }
    );

    res.clearCookie('refreshToken');
    res.ok({ message: 'Logged out' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`logout error: ${msg}`);
    next(error);
  }
};

export const logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.fail(401, 'Unauthorized');
      return;
    }
    const collection = await getUsersCollection();
    await collection.updateOne({ _id: new ObjectId(userId) }, { $set: { refreshTokens: [] } });
    res.clearCookie('refreshToken');
    res.ok({ message: 'Logged out from all sessions' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`logoutAll error: ${msg}`);
    next(error);
  }
};

export const revokeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { tokenId } = req.body as { tokenId?: string };

    if (!userId) {
      res.fail(401, 'Unauthorized');
      return;
    }
    if (!tokenId) {
      res.fail(400, 'tokenId is required');
      return;
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      res.fail(404, 'User not found');
      return;
    }

    const newTokens = (user.refreshTokens ?? []).filter((t) => t.tokenId !== tokenId);
    await collection.updateOne({ _id: user._id as ObjectId }, { $set: { refreshTokens: newTokens } });

    res.ok({ message: 'Session revoked' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`revokeSession error: ${msg}`);
    next(error);
  }
};
