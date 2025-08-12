/**
 * Auth service app
 * - CORS, rate limit, morgan->winston
 * - /api/v1/auth routes
 * - Central error handler
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

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(cookieParser());

app.use(morgan('combined', {
  stream: { write: (message: string) => logger.http(message.trim()) }
}));

const authLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 100,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/v1/auth', authLimiter);

// Health
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Routes
app.use('/api/v1/auth', authRoutes);

// Dev-only: log unmatched paths inside /api/v1 to debug 404s
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

// Error handler
app.use(errorHandler);

export default app;