import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Db, Collection, ObjectId } from 'mongodb';
import { config } from 'dotenv';
import { client } from '../server.js';
import { generateRefreshToken, verifyRefreshToken } from '../utils/token.js';
import { sendMagicLinkEmail } from '../utils/email.js';
import crypto from 'crypto';
config();

let db: Db | null = null;

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

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
        name: "",
        company: ""
      });
      user = await collection.findOne({ _id: insertResult.insertedId });
    } else {
      await collection.updateOne(
        { _id: user._id },
        { $set: { magicLinkToken, magicLinkTokenExpires } }
      );
      user = await collection.findOne({ _id: user._id });
    }

    const magicLink = `${process.env.FRONTEND_URL}/magic-link?token=${magicLinkToken}`;
    console.log('Preparing to send magic link to', email, magicLink);

    try {
      await sendMagicLinkEmail(email, magicLink);
      console.log('Magic link email sent to', email);
    } catch (err) {
      console.error('Error sending magic link email:', err);
      return res.status(500).json({ message: 'Failed to send magic link email.' });
    }

    res.status(200).json({ message: 'Magic link sent. Please check your email.' });
  } catch (error) {
    next(error);
  }
};

export const verifyMagicLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'Invalid magic link.' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ magicLinkToken: token });

    if (!user || !user.magicLinkTokenExpires || user.magicLinkTokenExpires < new Date()) {
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

    // Device info
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

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

    res
      .cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({ token: accessToken, user: { id: user._id!.toString(), email: user.email, name: user.name, company: user.company } });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { name, company } = req.body;
    if (!name || !company) {
      return res.status(400).json({ message: 'Name and company are required.' });
    }
    const collection = await getUsersCollection();
    const result = await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { name, company } }
    );
    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: 'Profile update failed.' });
    }
    res.json({ message: 'Profile updated' });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      const error = new Error('No refresh token provided');
      (error as any).status = 401;
      return next(error);
    }

    let payload;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch (err) {
      const error = new Error('Invalid or expired refresh token');
      (error as any).status = 401;
      return next(error);
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
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
      const error = new Error('Refresh token not recognized');
      (error as any).status = 401;
      return next(error);
    }

    // Remove the used/old refresh token
    cleanedTokens.splice(existingTokenIndex, 1);

    // Add the new refresh token
    const newRefreshToken = generateRefreshToken({ id: user._id!.toString(), email: user.email });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(newRefreshToken);

    // Device info
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

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

    const newAccessToken = jwt.sign(
      { id: user._id!.toString(), email: user.email, name: user.name, company: user.company },
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
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    let payload;
    try {
      payload = verifyRefreshToken(token) as any;
    } catch {
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(payload.id) });
    if (!user) {
      return res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
    }

    let cleanedTokens = cleanupTokens(user.refreshTokens);

    const providedTokenHash = hashToken(token);
    cleanedTokens = cleanedTokens.filter(t => t.tokenHash !== providedTokenHash);

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: cleanedTokens } }
    );

    res.clearCookie('refreshToken').status(200).json({ message: 'Logged out' });
  } catch (error) {
    next(error);
  }
};

// Logout from all sessions
export const logoutAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const collection = await getUsersCollection();
    await collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { refreshTokens: [] } }
    );
    res.clearCookie('refreshToken').status(200).json({ message: 'Logged out from all sessions' });
  } catch (error) {
    next(error);
  }
};

export const revokeSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { tokenId } = req.body; // The session/device to revoke

    if (!tokenId) {
      return res.status(400).json({ message: 'tokenId is required' });
    }

    const collection = await getUsersCollection();
    const user = await collection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newTokens = (user.refreshTokens || []).filter((t: any) => t.tokenId !== tokenId);

    await collection.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: newTokens } }
    );

    res.status(200).json({ message: 'Session revoked' });
  } catch (error) {
    next(error);
  }
};