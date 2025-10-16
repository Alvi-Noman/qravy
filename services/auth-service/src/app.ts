// services/auth-service/src/app.ts
/**
 * Auth service app
 * - Trust proxy (so rate-limit keys use real client IPs)
 * - Health route BEFORE any limiters (never limited)
 * - Targeted rate limits (risky auth endpoints only)
 * - Mild API-wide limiter
 * - JSON, cookies, logging
 * - Routes (+ legacy aliases)
 * - Dev 404 tracer
 * - Error handler
 */
import express, { type Application, type Request, type Response } from 'express';
import rateLimit, { ValueDeterminingMiddleware } from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import menuRoutes from './routes/menuItemsRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import userRoutes from './routes/userRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import accessRoutes from './routes/accessRoutes.js';
import categoriesRoutes from './routes/categoriesRoutes.js';

import logger from './utils/logger.js';
import { responseFormatter } from './middleware/response.js';
import { errorHandler } from './middleware/errorHandler.js';

const app: Application = express();

/** Use the gateway's X-Forwarded-* headers for req.ip, etc. */
app.set('trust proxy', 1);

/* ---------- CORS (explicit origins + credentials) ---------- */
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'https://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Note: We do NOT throw on disallowed origins. We simply return cb(null, false)
// so the request proceeds without CORS headers. This avoids noisy errors while
// still keeping a strict allowlist for browsers.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, false); // non-browser / same-origin / curl → no CORS headers
      const ok = CORS_ORIGINS.includes(origin);
      if (ok) return cb(null, true);
      logger.warn(`[CORS] blocked origin: ${origin}`);
      return cb(null, false);
    },
    credentials: true,
    // Good defaults; explicitly set preflight success for older browsers/proxies
    optionsSuccessStatus: 204,
  })
);

/** Health FIRST — never rate-limit this */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/* ---------- Core middleware ---------- */
app.use(express.json());
app.use(cookieParser());
app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

/** Uniform response envelope */
app.use(responseFormatter);

/* ---------- Helpers for rate limiting ---------- */
const isProd = process.env.NODE_ENV === 'production';
const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

/**
 * Allow separate knobs (recommended):
 * - RATE_LIMIT_MAX_API  : mild limit for general API (default 300/window)
 * - RATE_LIMIT_MAX_AUTH : tight limit for risky auth endpoints (default 20/window)
 * Fallback to RATE_LIMIT_MAX then to sensible defaults.
 */
const MAX_API =
  Number(process.env.RATE_LIMIT_MAX_API ?? process.env.RATE_LIMIT_MAX ?? 300);

const MAX_AUTH =
  Number(process.env.RATE_LIMIT_MAX_AUTH ?? Math.min(Number(process.env.RATE_LIMIT_MAX ?? 100), 20));

/** Ensure we ALWAYS return a string for keying the limiter */
function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xff) && xff.length > 0) {
    const first = String(xff[0]).split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Skip limiter in dev and for CORS preflights */
const skipCommon: ValueDeterminingMiddleware<boolean> = (req: Request, _res: Response) =>
  req.method === 'OPTIONS' || !isProd;

/* ---------- Rate limits (production only) ---------- */

/** Mild, general API limiter */
const apiLimiter = rateLimit({
  windowMs,
  max: MAX_API,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipCommon,
  keyGenerator: (req: Request) => getClientIp(req),
});

/** Tighter limiter only for risky auth endpoints */
const authLimiter = rateLimit({
  windowMs,
  max: MAX_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipCommon,
  message: { message: 'Too many requests, please try again later.' },
  keyGenerator: (req: Request) => getClientIp(req),
});

/**
 * IMPORTANT:
 * Do NOT wrap all /api/v1/auth with the tight limiter anymore.
 * Instead, target only the risky endpoints.
 */
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/signup', authLimiter);
app.use('/api/v1/auth/magic-link', authLimiter);

/** Apply the mild limiter to the broader API surface */
app.use('/api/v1', apiLimiter);

/* ---------- Routes ---------- */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/tenant', tenantRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/access', accessRoutes);
app.use('/api/v1/categories', categoriesRoutes);

/**
 * Legacy aliases under /api/v1/auth
 * (keeps existing clients hitting /api/v1/auth/... working)
 */
app.use('/api/v1/auth', menuRoutes);
app.use('/api/v1/auth', tenantRoutes);
app.use('/api/v1/auth', userRoutes);
app.use('/api/v1/auth', categoriesRoutes);

/* ---------- Dev-only 404 tracer ---------- */
if (!isProd) {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

/* ---------- Centralized error handler (last) ---------- */
app.use(errorHandler);

export default app;
