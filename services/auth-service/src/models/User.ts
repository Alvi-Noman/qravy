import { ObjectId } from 'mongodb';

export interface RefreshToken {
  tokenId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

export interface UserDoc {
  _id?: ObjectId;
  email: string;
  isVerified?: boolean;

  tenantId?: ObjectId;

  refreshTokens?: RefreshToken[];

  failedLoginAttempts?: number;
  lockUntil?: Date | null;

  magicLinkToken?: string;
  magicLinkTokenExpires?: Date;
}