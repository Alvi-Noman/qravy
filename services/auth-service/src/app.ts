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
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import handoverRoutes from './routes/handoverRoutes.js';
import menuRoutes from './routes/menuItemsRoutes.js';
import eventsRoutes from './routes/eventsRoutes.js';
import cortexRoutes from './routes/cortexRoutes.js';
import insightsRoutes from './routes/insightsRoutes.js';
import domainRoutes from './routes/domainRoutes.js';
import pronounceRoutes from './routes/pronounceRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import userRoutes from './routes/userRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import accessRoutes from './routes/accessRoutes.js';
import categoriesRoutes from './routes/categoriesRoutes.js';
import publicRoutes from './routes/publicRoutes.js'; // ✅ added
import menuImportsRoutes from './routes/menuImportsRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import customersRoutes from './routes/customersRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import serviceRequestRoutes from './routes/serviceRequestRoutes.js';
import quickDemoRoutes from './routes/quickDemoRoutes.js';

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

// We do NOT throw on disallowed origins; we just skip CORS headers.
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
    optionsSuccessStatus: 204,
  })
);

/** Health FIRST — never rate-limit this */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/* ---------- Core middleware ---------- */
// Menu-import drafts (hundreds of items) exceed the default 100kb JSON limit
app.use('/api/v1/menu-imports', express.json({ limit: '5mb' }));
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
// (each limiter has its own window below — RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX are no longer read)

/**
 * The API's limits — no longer RATE_LIMIT_MAX (the example env's 100 per 15 min was applied to the WHOLE API per IP:
 * one dashboard used it up in minutes, an office's Wi-Fi locked everyone out, a busy restaurant's guests on its Wi-Fi
 * would have lost the menu):
 * - signed in: per USER, per minute (RATE_LIMIT_MAX_API_USER, default 600)
 * - not signed in (the storefront's guests): per IP, per minute (RATE_LIMIT_MAX_API_IP, default 2000 — they share Wi-Fi)
 * - login emails: per email address (RATE_LIMIT_MAX_AUTH, default 10 / 15 min) + per IP (RATE_LIMIT_MAX_EMAILS_IP, 200)
 * (RATE_LIMIT_MAX_API sets both API limits — the tests use it.)
 */
const MAX_API_USER = Number(process.env.RATE_LIMIT_MAX_API_USER ?? process.env.RATE_LIMIT_MAX_API ?? 600);
const MAX_API_IP = Number(process.env.RATE_LIMIT_MAX_API_IP ?? process.env.RATE_LIMIT_MAX_API ?? 2000);
const MAX_AUTH = Number(process.env.RATE_LIMIT_MAX_AUTH ?? 10);
const MAX_EMAILS_IP = Number(process.env.RATE_LIMIT_MAX_EMAILS_IP ?? 200);

/** The signed-in user (a valid access token), for keying limits per person; null for guests. */
function signedInUser(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ') || !process.env.JWT_SECRET) return null;
  try {
    const p = jwt.verify(h.slice(7), process.env.JWT_SECRET) as { id?: unknown };
    return typeof p?.id === 'string' ? p.id : null;
  } catch {
    return null;
  }
}

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

/** The general API limiter: per signed-in user, else per IP — per minute */
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: (req: Request) => (signedInUser(req) ? MAX_API_USER : MAX_API_IP),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipCommon,
  keyGenerator: (req: Request) => {
    const user = signedInUser(req);
    return user ? `user:${user}` : `ip:${getClientIp(req)}`;
  },
  handler: (req: Request, res: Response) => tooMany('requests')(req, res),
});

/**
 * Guest activity tracking (POST /public/events — the storefront's tracker) has its own, larger budget: a restaurant's
 * guests often share its Wi-Fi IP, and tracking must never use up that IP's allowance for menus and orders.
 */
const eventsLimiter = rateLimit({
  windowMs: 60_000, // per minute (RATE_LIMIT_WINDOW_MS=15 min made it 3000 per 15 min for a whole restaurant's Wi-Fi)
  max: Number(process.env.RATE_LIMIT_MAX_EVENTS ?? 3000),
  standardHeaders: false,
  legacyHeaders: false,
  skip: skipCommon,
  keyGenerator: (req: Request) => getClientIp(req),
  handler: (_req: Request, res: Response) => res.status(204).end(), // over budget: drop quietly (tracking only)
});

/** "Too many attempts — try again in N minutes." (the limiter's own reset time, not a vague "later") */
const tooMany = (what: string) => (req: Request, res: Response) => {
  const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  const mins = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 60_000)) : 15;
  res.status(429).json({ message: `Too many ${what}. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
};
const who = (req: Request) =>
  String((req.body as { email?: unknown; login?: unknown } | undefined)?.email ?? (req.body as { login?: unknown })?.login ?? '')
    .trim()
    .toLowerCase();

/**
 * Sending codes / magic links and signing up cost an email each: per IP (sending only — opening the link is a GET and
 * isn't counted). Each risky endpoint has its OWN budget: they used to share one, so a restaurant's staff logging in on
 * the same Wi-Fi (and opening their links) locked the Cortex sign-in out for 15 minutes.
 */
const sendLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: MAX_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => skipCommon(req, res) || req.method !== 'POST',
  // per email address: one person retrying their own login never blocks their colleagues
  keyGenerator: (req: Request) => `${getClientIp(req)}|${who(req)}`,
  handler: tooMany('login emails to this address'),
});
// …and a looser cap per network (no flooding many addresses from one place)
const sendLimiterIp = rateLimit({
  windowMs: 15 * 60_000,
  max: MAX_EMAILS_IP,
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req, res) => skipCommon(req, res) || req.method !== 'POST',
  keyGenerator: (req: Request) => getClientIp(req),
  handler: tooMany('login emails from this network'),
});

/**
 * Guessing protection: only FAILED attempts count, per IP + account (a right password / code never uses it up; one
 * person's typos don't lock their colleagues out). The 5-digit email code had no limit at all.
 */
const failedAttempts = (what: string, max: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipCommon,
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => `${getClientIp(req)}|${who(req)}`,
    handler: tooMany(what),
  });

app.use('/api/v1/auth/login', sendLimiterIp, sendLimiter);
app.use('/api/v1/auth/signup', sendLimiterIp, sendLimiter);
app.use('/api/v1/auth/magic-link', sendLimiterIp, sendLimiter);
app.use('/api/v1/auth/otp/verify', failedAttempts('wrong codes', Number(process.env.RATE_LIMIT_MAX_CODE_FAILS ?? 10)));
// the company admin panel's sign-in
app.use('/api/v1/cortex/login', failedAttempts('failed sign-in attempts', Number(process.env.RATE_LIMIT_MAX_CORTEX_FAILS ?? 10)));

/** Apply the mild limiter to the broader API surface */
app.use('/api/v1/public/events', eventsLimiter);
// (the tracker's events are counted above, not here)
app.use('/api/v1', (req, res, next) => (req.path === '/public/events' ? next() : apiLimiter(req, res, next)));

/* ---------- Routes ---------- */
// Mount public routes at /api/v1 so router.get('/public/menu') → /api/v1/public/menu
app.use('/api/v1', publicRoutes);          // ✅ fixed mount
app.use('/api/v1', eventsRoutes); // POST /public/events — what guests do in the storefront (for Cortex)
app.use('/api/v1', cortexRoutes); // /cortex/* — the company admin panel (apps/cortex)
app.use('/api/v1', insightsRoutes); // /insights/* — a restaurant's own performance (dashboard → Insights)
app.use('/api/v1', pronounceRoutes); // the waiter's pronunciation learner: /public/pronounce, /cortex/pronunciations
app.use('/api/v1', domainRoutes); // /tenants/me/domain — the restaurant's own domain; /public/domain — which restaurant a host is
app.use('/api/v1/auth', handoverRoutes); // app.qravy.com → admin.qravy.com: sign-in and paired devices carry over
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/tenant', tenantRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/access', accessRoutes);
app.use('/api/v1/categories', categoriesRoutes);
app.use('/api/v1', menuImportsRoutes); // /api/v1/menu-imports
app.use('/api/v1', supportRoutes); // Qravy support access: Cortex opens a restaurant's dashboard as its admin
app.use('/api/v1', customersRoutes); // /api/v1/customers — the restaurant's online customers
app.use('/api/v1', orderRoutes); // /api/v1/public/orders (guests) + /api/v1/orders (staff)
app.use('/api/v1', serviceRequestRoutes); // /api/v1/public/service-requests ("Call waiter") + /api/v1/service-requests (staff)
app.use('/api/v1', quickDemoRoutes); // /api/v1/public/quick-demo (no account)

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
