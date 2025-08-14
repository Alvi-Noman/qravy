/**
 * Auth service app
 * - CORS (incl. PATCH/DELETE) + OPTIONS
 * - Rate limit (skips OPTIONS so preflights don't count)
 * - JSON, cookies, logging
 * - Routes + Dev 404 tracer
 * - Error handler
 */
import { errorHandler } from './middleware/errorHandler.js';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import logger from './utils/logger.js';
import morgan from 'morgan';

const app: Application = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  })
);
app.options('*', cors());

app.use(express.json());
app.use(cookieParser());

app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

/**
 * Rate limiter for /api/v1/auth
 * - Skips OPTIONS so CORS preflights don't “double count”
 * - Standard RateLimit-* headers; legacy X-RateLimit-* disabled
 */
const authLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  skip: (req) => req.method === 'OPTIONS',
});
app.use('/api/v1/auth', authLimiter);

// Health
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/api/v1/auth', authRoutes);

// Dev-only 404 tracer
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

// Error handler
app.use(errorHandler);

export default app;