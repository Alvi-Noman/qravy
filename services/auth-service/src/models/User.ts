import { ObjectId } from 'mongodb';

export interface RefreshToken {
  tokenId: string;
  tokenHash: string; 
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

interface User {
  _id?: ObjectId;
  email: string;
  name: string;
  company: string;
  failedLoginAttempts?: number;
  lockUntil?: Date | null;
  refreshTokens?: RefreshToken[];
  isVerified?: boolean;
  magicLinkToken?: string;
  magicLinkTokenExpires?: Date;
}

export default User;