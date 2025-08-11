import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';

export async function requireOnboardedUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const db = client.db('authDB');
    const user = await db.collection('users').findOne({ _id: new ObjectId(payload.id) });
    if (!user || !user.isVerified || !user.isOnboarded) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    // Attach user and restaurantId to req
    (req as any).user = user;
    (req as any).restaurantId = user.restaurantId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}