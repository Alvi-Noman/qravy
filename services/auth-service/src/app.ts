/**
 * Auth service app
 * - Rate limit (skips OPTIONS so preflights don't count)
 * - JSON, cookies, logging
 * - Routes (+ legacy aliases under /api/v1/auth)
 * - Dev 404 tracer
 * - Error handler
 */
import express, { type Application, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import authRoutes from './routes/authRoutes.js';
import menuRoutes from './routes/menuItemsRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import userRoutes from './routes/userRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import accessRoutes from './routes/accessRoutes.js'; // ADD

import logger from './utils/logger.js';
import { responseFormatter } from './middleware/response.js';
import { errorHandler } from './middleware/errorHandler.js';

const app: Application = express();

app.set('trust proxy', 1);

// Core middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

// Uniform response envelope
app.use(responseFormatter);

// Rate limit only auth endpoints in production
const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_MAX ?? 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV !== 'production',
});
app.use('/api/v1/auth', authLimiter);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Routes
 * Keep each router under its own base path…
 */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/tenant', tenantRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/access', accessRoutes); // ADD

/**
 * …and add legacy aliases under /api/v1/auth for backward compatibility
 * so existing clients calling /api/v1/auth/tenants/me, /api/v1/auth/menu-items, etc. continue to work.
 */
app.use('/api/v1/auth', menuRoutes);
app.use('/api/v1/auth', tenantRoutes);
app.use('/api/v1/auth', userRoutes);

// Dev-only 404 tracer for /api/v1/* (helps catch wrong paths)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

// Centralized error handler (must be last)
app.use(errorHandler);

export default app;