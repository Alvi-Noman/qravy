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
config();

let db: Db | null = null;

function userInfo(user: any) {
  return user ? `${user.email} (${user._id})` : 'unknown user';
}

export async function getUsersCollection(): Promise<Collection> {
  if (!db) {
    db = client.db('authDB');
  }
  if (!db) throw new Error('Database not initialized');
  return db.collection('users');
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanupTokens(tokens: any[]) {
  const now = new Date();
  return (tokens || []).filter(token => token.expiresAt > now);
}

function generateMagicLinkToken() {
  return crypto.randomBytes(32).toString('hex');
}

export const sendMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email: rawEmail } = req.body;
    const email = rawEmail.toLowerCase();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      logger.warn(`Invalid email address attempt: ${rawEmail} from IP ${ip}`);
      return res.status(400).json({ message: 'Invalid email address.' });
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
        isOnboarded: false
      });
      user = await collection.findOne({ _id: insertResult.insertedId });
      logger.info(`Created new user: ${email} from IP ${ip}`);
    } else {
      await collection.updateOne(
        { _id: user._id },
        { $set: { magicLinkToken, magicLinkTokenExpires } }
      );
      user = await collection.findOne({ _id: user._id });
      logger.info(`Updated magic link for user: ${email} from IP ${ip}`);
    }

    const magicLink = `${process.env.FRONTEND_URL}/magic-link?token=${magicLinkToken}`;
    logger.info(`Preparing to send magic link to ${email} from IP ${ip}`);

    try {
      await sendMagicLinkEmail(email, magicLink);
      logger.info(`Magic link email sent to ${email}`);
    } catch (err) {
      logger.error(`Error sending magic link email to ${email}: ${(err as Error).message}`);
      return res.status(500).json({ message: 'Failed to send magic link email.' });
    }

    res.status(200).json({ message: 'Magic link sent. Please check your email.' });
  } catch (error) {
    logger.error(`sendMagicLink error: ${(error as Error).message}`);
    next(error);
  }
};

export const verifyMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!token || typeof token !== 'string') {
      logger.warn(`Invalid magic link token received from IP ${ip}`);
      return res.status(400).json({ message: 'Invalid or expired magic link.' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ magicLinkToken: token });

    if (!user || !user.magicLinkTokenExpires || user.magicLinkTokenExpires < new Date()) {
      logger.warn(`Attempt to use invalid or expired magic link from IP ${ip}`);
      return res.status(400).json({ message: 'Invalid or expired magic link.' });
    }

    await collection.updateOne(
      { _id: user._id },
      { $set: { isVerified: true }, $unset: { magicLinkToken: "", magicLinkTokenExpires: "" } }
    );

    const accessToken = jwt.sign(
      { id: user._id!.toString(), email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    const refreshToken = generateRefreshToken({ id: user._id!.toString(), email: user.email });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(refreshToken);

    const cleanedTokens = cleanupTokens(user.refreshTokens);

    const userAgent = req.headers['user-agent'] || 'unknown';

    cleanedTokens.push({
      tokenId,
      tokenHash,
      createdAt: new Date(),
      expiresAt,
      userAgent,
      ip,
    });

    while (cleanedTokens.length > 5) {
      cleanedTokens.shift();
    }

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: cleanedTokens } }
    );

    logger.info(`User verified magic link: ${userInfo(user)} from IP ${ip}`);

    res
      .cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({
        token: accessToken,
        user: {
          id: user._id!.toString(),
          email: user.email,
          isVerified: true,
          isOnboarded: user.isOnboarded
        }
      });
  } catch (error) {
    logger.error(`verifyMagicLink error: ${(error as Error).message}`);
    next(error);
  }
};

// Mark onboarding as complete (JWT-protected)
export const completeOnboarding = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const collection = await getUsersCollection();
    await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { isOnboarded: true } }
    );
    logger.info(`User onboarding completed: ${userId}`);
    res.json({ message: 'Onboarding complete' });
  } catch (error) {
    logger.error(`completeOnboarding error: ${(error as Error).message}`);
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!token) {
      logger.warn('No refresh token provided');
      const error = new Error('No refresh token provided');
      (error as any).status = 401;
      return next(error);
    }

    let payload;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch (err) {
      logger.warn('Invalid or expired refresh token');
      const error = new Error('Invalid or expired refresh token');
      (error as any).status = 401;
      return next(error);
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
      logger.warn('User not found during refresh token');
      const error = new Error('User not found');
      (error as any).status = 401;
      return next(error);
    }

    let cleanedTokens = cleanupTokens(user.refreshTokens);

    const providedTokenHash = hashToken(token);
    const existingTokenIndex = cleanedTokens.findIndex(
      t => t.tokenHash === providedTokenHash
    );
    if (existingTokenIndex === -1) {
      logger.warn('Refresh token not recognized');
      const error = new Error('Refresh token not recognized');
      (error as any).status = 401;
      return next(error);
    }

    cleanedTokens.splice(existingTokenIndex, 1);

    const newRefreshToken = generateRefreshToken({ id: user._id!.toString(), email: user.email });
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

    while (cleanedTokens.length > 5) {
      cleanedTokens.shift();
    }

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: cleanedTokens } }
    );

    logger.info(`Refresh token issued for user: ${userInfo(user)} from IP ${ip}`);

    const newAccessToken = jwt.sign(
      { id: user._id!.toString(), email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    res
      .cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      })
      .json({ token: newAccessToken });
  } catch (error) {
    logger.error(`refreshToken error: ${(error as Error).message}`);
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!token) {
      logger.info(`Logout: No refresh token provided from IP ${ip}`);
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch {
      logger.info(`Logout: Invalid or expired refresh token from IP ${ip}`);
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
      logger.info(`Logout: User not found from IP ${ip}`);
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    let cleanedTokens = cleanupTokens(user.refreshTokens);

    const providedTokenHash = hashToken(token);
    cleanedTokens = cleanedTokens.filter(t => t.tokenHash !== providedTokenHash);

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: cleanedTokens } }
    );

    logger.info(`User logged out: ${userInfo(user)} from IP ${ip}`);
    res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
  } catch (error) {
    logger.error(`logout error: ${(error as Error).message}`);
    next(error);
  }
};

export const logoutAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const collection = await getUsersCollection();
    await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { refreshTokens: [] } }
    );
    logger.info(`User logged out from all sessions: ${userId}`);
    res.clearCookie('refreshToken').status(200).json({ message: 'Logged out from all sessions' });
  } catch (error) {
    logger.error(`logoutAll error: ${(error as Error).message}`);
    next(error);
  }
};

export const revokeSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { tokenId } = req.body;

    if (!tokenId) {
      logger.warn(`revokeSession: tokenId missing for user ${userId}`);
      return res.status(400).json({ message: 'tokenId is required' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      logger.warn(`revokeSession: User not found for userId ${userId}`);
      return res.status(404).json({ message: 'User not found' });
    }

    const newTokens = (user.refreshTokens || []).filter((t: any) => t.tokenId !== tokenId);

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: newTokens } }
    );

    logger.info(`Session revoked for user: ${userInfo(user)}, tokenId: ${tokenId}`);
    res.status(200).json({ message: 'Session revoked' });
  } catch (error) {
    logger.error(`revokeSession error: ${(error as Error).message}`);
    next(error);
  }
};