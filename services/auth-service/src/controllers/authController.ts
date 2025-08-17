/**
 * Auth controller
 * - Magic link send/verify
 * - Refresh/logout/session management
 * - Complete onboarding
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Db, Collection, ObjectId } from 'mongodb';
import { config } from 'dotenv';
import { client } from '../db.js';
import { generateRefreshToken, verifyRefreshToken } from '../utils/token.js';
import { sendMagicLinkEmail } from '../utils/email.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import type { UserDoc } from '../models/User.js';

config();

let db: Db | null = null;

/** Simple formatter for logs */
function userInfo(user: any) {
  return user ? `${user.email} (${user._id})` : 'unknown user';
}

/** Typed users collection helper */
export async function getUsersCollection(): Promise<Collection<UserDoc>> {
  if (!db) {
    db = client.db('authDB');
  }
  if (!db) throw new Error('Database not initialized');
  return db.collection<UserDoc>('users');
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupTokens(tokens: any[]) {
  const now = new Date();
  return (tokens || []).filter((token) => token.expiresAt > now);
}

function generateMagicLinkToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** POST /api/v1/auth/magic-link */
export const sendMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email: rawEmail } = req.body as { email: string };
    const email = rawEmail.toLowerCase();
    const ip = req.ip || (req.connection as any).remoteAddress || 'unknown';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      logger.warn(`Invalid email address attempt: ${rawEmail} from IP ${ip}`);
      return res.fail(400, 'Invalid email address.');
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
        isOnboarded: false,
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

    const magicLink = `${process.env.FRONTEND_URL}/magic-link?token=${magicLinkToken}`;
    logger.info(`Preparing to send magic link to ${email} from IP ${ip}`);

    try {
      await sendMagicLinkEmail(email, magicLink);
      logger.info(`Magic link email sent to ${email}`);
    } catch (err) {
      logger.error(`Error sending magic link email to ${email}: ${(err as Error).message}`);
      return res.fail(500, 'Failed to send magic link email.');
    }

    return res.ok({ message: 'Magic link sent. Please check your email.' });
  } catch (error) {
    logger.error(`sendMagicLink error: ${(error as Error).message}`);
    next(error);
  }
};

/** GET /api/v1/auth/magic-link/verify */
export const verifyMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;
    const ip = req.ip || (req.connection as any).remoteAddress || 'unknown';

    if (!token || typeof token !== 'string') {
      logger.warn(`Invalid magic link token received from IP ${ip}`);
      return res.fail(400, 'Invalid or expired magic link.');
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ magicLinkToken: token });

    if (!user || !user.magicLinkTokenExpires || user.magicLinkTokenExpires < new Date()) {
      logger.warn(`Attempt to use invalid or expired magic link from IP ${ip}`);
      return res.fail(400, 'Invalid or expired magic link.');
    }

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { isVerified: true }, $unset: { magicLinkToken: '', magicLinkTokenExpires: '' } }
    );

    const accessToken = jwt.sign(
      { id: (user._id as ObjectId).toString(), email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    const refreshToken = generateRefreshToken({
      id: (user._id as ObjectId).toString(),
      email: user.email,
    });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(refreshToken);

    const cleanedTokens = cleanupTokens(user.refreshTokens || []);

    const userAgent = req.headers['user-agent'] || 'unknown';

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

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.ok({
      token: accessToken,
      user: {
        id: (user._id as ObjectId).toString(),
        email: user.email,
        isVerified: true,
        isOnboarded: user.isOnboarded,
      },
    });
  } catch (error) {
    logger.error(`verifyMagicLink error: ${(error as Error).message}`);
    next(error);
  }
};

/** POST /api/v1/auth/onboarding/complete (JWT protected) */
export const completeOnboarding = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const collection = await getUsersCollection();
    await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { isOnboarded: true } }
    );
    logger.info(`User onboarding completed: ${userId}`);
    return res.ok({ message: 'Onboarding complete' });
  } catch (error) {
    logger.error(`completeOnboarding error: ${(error as Error).message}`);
    next(error);
  }
};

/** POST /api/v1/auth/refresh-token */
export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = (req as any).cookies.refreshToken;
    const ip = req.ip || (req.connection as any).remoteAddress || 'unknown';

    if (!token) {
      return res.fail(401, 'No refresh token provided');
    }

    let payload: any;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch {
      return res.fail(401, 'Invalid or expired refresh token');
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
      return res.fail(401, 'User not found');
    }

    let cleanedTokens = cleanupTokens(user.refreshTokens || []);

    const providedTokenHash = hashToken(token);
    const existingTokenIndex = cleanedTokens.findIndex((t: any) => t.tokenHash === providedTokenHash);
    if (existingTokenIndex === -1) {
      return res.fail(401, 'Refresh token not recognized');
    }

    cleanedTokens.splice(existingTokenIndex, 1);

    const newRefreshToken = generateRefreshToken({
      id: (user._id as ObjectId).toString(),
      email: user.email,
    });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(newRefreshToken);

    const userAgent = req.headers['user-agent'] || 'unknown';

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

    const newAccessToken = jwt.sign(
      { id: (user._id as ObjectId).toString(), email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.ok({ token: newAccessToken });
  } catch (error) {
    logger.error(`refreshToken error: ${(error as Error).message}`);
    next(error);
  }
};

/** POST /api/v1/auth/logout */
export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = (req as any).cookies.refreshToken;

    if (!token) {
      res.clearCookie('refreshToken');
      return res.ok({ message: 'Logged out' });
    }

    let payload: any;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch {
      res.clearCookie('refreshToken');
      return res.ok({ message: 'Logged out' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
      res.clearCookie('refreshToken');
      return res.ok({ message: 'Logged out' });
    }

    let cleanedTokens = cleanupTokens(user.refreshTokens || []);
    const providedTokenHash = hashToken(token);
    cleanedTokens = cleanedTokens.filter((t: any) => t.tokenHash !== providedTokenHash);

    await collection.updateOne(
      { _id: user._id as ObjectId },
      { $set: { refreshTokens: cleanedTokens } }
    );

    res.clearCookie('refreshToken');
    return res.ok({ message: 'Logged out' });
  } catch (error) {
    logger.error(`logout error: ${(error as Error).message}`);
    next(error);
  }
};

/** POST /api/v1/auth/logout-all */
export const logoutAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const collection = await getUsersCollection();
    await collection.updateOne({ _id: new ObjectId(userId) }, { $set: { refreshTokens: [] } });
    res.clearCookie('refreshToken');
    return res.ok({ message: 'Logged out from all sessions' });
  } catch (error) {
    logger.error(`logoutAll error: ${(error as Error).message}`);
    next(error);
  }
};

/** POST /api/v1/auth/revoke-session */
export const revokeSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { tokenId } = req.body as { tokenId?: string };

    if (!tokenId) return res.fail(400, 'tokenId is required');

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(userId) });
    if (!user) return res.fail(404, 'User not found');

    const newTokens = (user.refreshTokens || []).filter((t: any) => t.tokenId !== tokenId);
    await collection.updateOne({ _id: user._id as ObjectId }, { $set: { refreshTokens: newTokens } });

    return res.ok({ message: 'Session revoked' });
  } catch (error) {
    logger.error(`revokeSession error: ${(error as Error).message}`);
    next(error);
  }
};