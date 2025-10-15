import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your_refresh_secret';
const INVITE_TOKEN_SECRET = process.env.INVITE_TOKEN_SECRET || 'your_invite_secret';

// ———————————————————————————————————————————————————————————————
// Refresh token helpers (existing)
// ———————————————————————————————————————————————————————————————
export function generateRefreshToken(payload: object) {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
}

// ———————————————————————————————————————————————————————————————
// Invite token helpers (new for Admin Access)
// ———————————————————————————————————————————————————————————————
export function generateInviteToken(payload: object) {
  // short-lived token, valid for 7 days
  return jwt.sign(payload, INVITE_TOKEN_SECRET, { expiresIn: '7d' });
}

export function verifyInviteToken(token: string) {
  return jwt.verify(token, INVITE_TOKEN_SECRET);
}

// Optional: if you want a random fallback token (non-JWT)
export function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}
