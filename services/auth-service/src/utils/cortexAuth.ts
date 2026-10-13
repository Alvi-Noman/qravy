// services/auth-service/src/utils/cortexAuth.ts
// Cortex — the company's own admin panel (Qravy staff, not restaurants). Its admins and sessions are separate from
// restaurant logins: their own collection (cortexAdmins), their own token secret, so a restaurant token can never open
// Cortex and a Cortex token is useless anywhere else.
//
// The first admin comes from the server's environment (never from the code or git):
//   CORTEX_ADMIN_EMAIL          e.g. you@company.com
//   CORTEX_ADMIN_USERNAMES      e.g. "alvinoman" (comma-separated, any case)
//   CORTEX_ADMIN_PASSWORD_HASH  made with: node services/auth-service/scripts/cortex-hash.mjs
// Re-applied on every start, so changing the hash there changes the password.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { client } from '../db.js';
import logger from './logger.js';

export type CortexAdminDoc = {
  _id?: unknown;
  email: string;
  usernames: string[];
  passwordHash: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
};

export const cortexAdmins = () => client.db('authDB').collection<CortexAdminDoc>('cortexAdmins');

/* ------------------------------------------------------------------ passwords (scrypt, no extra dependency) */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  // ":" separated (a "$" in an env file can be expanded by Docker Compose)
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, n, r, p, saltB64, hashB64] = String(stored || '').split(/[:$]/);
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), want.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/* ------------------------------------------------------------------ the admin from the environment */

export async function ensureCortexAdmin(): Promise<void> {
  const email = String(process.env.CORTEX_ADMIN_EMAIL || '').trim().toLowerCase();
  const hash = String(process.env.CORTEX_ADMIN_PASSWORD_HASH || '').trim();
  const usernames = String(process.env.CORTEX_ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  await cortexAdmins().createIndex({ email: 1 }, { unique: true, name: 'ux_cortex_email' });
  await cortexAdmins().createIndex({ usernames: 1 }, { name: 'ix_cortex_usernames' });
  if (!email || !/^scrypt[:$]/.test(hash)) {
    logger.info('[cortex] no CORTEX_ADMIN_EMAIL / CORTEX_ADMIN_PASSWORD_HASH — Cortex admin not (re)set');
    return;
  }
  const now = new Date();
  await cortexAdmins().updateOne(
    { email },
    { $set: { email, usernames, passwordHash: hash, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  logger.info(`[cortex] admin ${email} ready`);
}

/* ------------------------------------------------------------------ sessions */

/** Cortex's own signing secret: CORTEX_JWT_SECRET, or one derived from JWT_SECRET (never the same key). */
function secret(): string {
  const own = process.env.CORTEX_JWT_SECRET;
  if (own) return own;
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update('qravy-cortex').digest('hex');
}

const AUDIENCE = 'qravy-cortex';

export function signCortexToken(admin: { email: string }): string {
  return jwt.sign({ email: admin.email, cortex: true }, secret(), { expiresIn: '12h', audience: AUDIENCE });
}

declare global {
  namespace Express {
    interface Request {
      cortex?: { email: string };
    }
  }
}

/** Cortex endpoints: a valid Cortex token from a Cortex admin that still exists. */
export async function requireCortex(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    const p = jwt.verify(token, secret(), { audience: AUDIENCE }) as { email?: string; cortex?: boolean };
    if (!p?.cortex || !p.email) throw new Error('not cortex');
    const admin = await cortexAdmins().findOne({ email: p.email }, { projection: { email: 1 } });
    if (!admin) throw new Error('gone');
    req.cortex = { email: admin.email };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Sign in to Cortex' });
  }
}

/** POST /cortex/login { login (email or username), password } */
export async function cortexLogin(req: Request, res: Response): Promise<void> {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!login || !password) {
    res.status(400).json({ success: false, message: 'Email or username, and password' });
    return;
  }
  const admin = await cortexAdmins().findOne({ $or: [{ email: login }, { usernames: login }] });
  // same answer and roughly the same work either way (no telling which part was wrong)
  const ok = admin ? verifyPassword(password, admin.passwordHash) : (hashPassword(password), false);
  if (!admin || !ok) {
    logger.warn(`[cortex] failed sign-in for "${login}" from ${req.ip}`);
    res.status(401).json({ success: false, message: 'Wrong email/username or password' });
    return;
  }
  await cortexAdmins().updateOne({ email: admin.email }, { $set: { lastLoginAt: new Date() } });
  logger.info(`[cortex] ${admin.email} signed in from ${req.ip}`);
  res.json({ success: true, token: signCortexToken(admin), admin: { email: admin.email, usernames: admin.usernames } });
}
