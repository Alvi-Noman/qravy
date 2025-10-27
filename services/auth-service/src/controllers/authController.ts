// services/auth-service/src/controllers/authController.ts
import type { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Db, Collection, ObjectId } from 'mongodb';
import { config } from 'dotenv';
import { client } from '../db.js';
import { generateRefreshToken, verifyRefreshToken } from '../utils/token.js';
import { sendMagicLinkEmail } from '../utils/email.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import type { UserDoc, RefreshToken } from '../models/User.js';
import { computeCapabilities } from '@qravy/shared/utils/policy';

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

/** Consistent cookie options for refresh token (set and clear). */
const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,             // always HTTPS; use mkcert for localhost during dev (prod default)
  sameSite: 'none' as 'none' | 'lax' | 'strict',
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
} satisfies CookieOptions;

/**
 * Request-aware cookie options:
 * - http localhost → secure=false, sameSite='lax'
 * - https behind gateway (Render/Vercel) → secure=true, sameSite='none'
 */
function cookieOptsFor(req: Request): CookieOptions {
  const isSecure = req.secure || req.get('x-forwarded-proto') === 'https';
  const opts: CookieOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
  return opts;
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

    if (tenant?.ownerId && (tenant.ownerId as ObjectId).toString() === (user._id as ObjectId).toString()) {
      role = 'owner';
    } else {
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
        role = 'viewer';
      }
    }
  }

  return { role, tenantIdStr, isOnboarded };
}

/** Compute the base URL for magic links using request Origin allowlist. */
function getMagicLinkBaseUrl(req: Request): { baseUrl: string; fallbackLink?: string } {
  const requestOrigin = (req.get('origin') || '').trim().replace(/\/$/, '');
  const allowed = (process.env.ALLOWED_DEV_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const primaryBase = (process.env.FRONTEND_URL || 'https://app.qravy.com').trim().replace(/\/$/, '');
  const useDev = !!requestOrigin && allowed.includes(requestOrigin);
  const baseUrl = useDev ? requestOrigin : primaryBase;

  const fallbackBase = process.env.FALLBACK_FRONTEND_URL?.trim()?.replace(/\/$/, '');
  const fallbackLink = fallbackBase ? `${fallbackBase}/magic-link?token=` : undefined;

  logger.info(
    `[magic-link] origin=${requestOrigin || 'n/a'} allowed=${useDev} base=${baseUrl}` +
      (fallbackLink ? ` fallbackBase=${fallbackBase}` : '')
  );

  return { baseUrl, fallbackLink };
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

    const { baseUrl, fallbackLink } = getMagicLinkBaseUrl(req);
    const magicLink = `${baseUrl}/magic-link?token=${magicLinkToken}`;
    const fallbackFull = fallbackLink ? `${fallbackLink}${magicLinkToken}` : undefined;

    logger.info(
      `Preparing to send magic link to ${email} from IP ${ip} (primary=${magicLink}` +
        (fallbackFull ? `, fallback=${fallbackFull}` : '') +
        `)`
    );

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

    const { role, tenantIdStr, isOnboarded } = await resolveUserRoleAndTenantInfo(user);

    const sessionType: 'member' | 'branch' = 'member';

    const capabilities = computeCapabilities({
      role,
      sessionType,
    });

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

    // Set refresh cookie with request-aware flags
    res.cookie(REFRESH_COOKIE_NAME, refreshTokenValue, cookieOptsFor(req));

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
    const token = cookies?.[REFRESH_COOKIE_NAME];
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

    const cleanedTokens = cleanupTokens(user.refreshTokens);
    const providedTokenHash = hashToken(token);
    const existingTokenIndex = cleanedTokens.findIndex((t) => t.tokenHash === providedTokenHash);
    if (existingTokenIndex === -1) {
      res.fail(401, 'Refresh token not recognized');
      return;
    }
    cleanedTokens.splice(existingTokenIndex, 1);

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

    const { role } = await resolveUserRoleAndTenantInfo(user);
    const sessionType: 'member' | 'branch' = 'member';

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

    // Rotate cookie with request-aware flags
    res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, cookieOptsFor(req));

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
    const token = cookies?.[REFRESH_COOKIE_NAME];

    if (!token) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
      res.ok({ message: 'Logged out' });
      return;
    }

    let payload: unknown;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
      res.ok({ message: 'Logged out' });
      return;
    }

    if (!isJwtPayloadWithIdEmail(payload)) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
      res.ok({ message: 'Logged out' });
      return;
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId((payload as any).id) });
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
      res.ok({ message: 'Logged out' });
      return;
    }

    const providedTokenHash = hashToken(token);
    const cleanedTokens = (user.refreshTokens ?? []).filter((t) => t.tokenHash !== providedTokenHash);

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { refreshTokens: cleanedTokens } }
    );

    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
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

    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptsFor(req));
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