/**
 * User document shape for MongoDB (TypeScript-only type).
 */
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
  isOnboarded?: boolean;

  refreshTokens?: RefreshToken[];

  // Optional security fields
  failedLoginAttempts?: number;
  lockUntil?: Date | null;

  // Magic link fields
  magicLinkToken?: string;
  magicLinkTokenExpires?: Date;
}