/**
 * Auth service
 * - CORS (mirrors gateway; safe for direct calls)
 * - Rate limit, JSON, cookies, logging
 * - Routes
 * - Error handler
 */
import { errorHandler } from './middleware/errorHandler.js';
import express, { Application, Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import logger from './utils/logger.js';
import morgan from 'morgan';

const app: Application = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const corsOptions: CorsOptions = {
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

const authLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 100,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/v1/auth', authLimiter);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);

// Dev-only: log unmatched inside /api/v1 for quick 404 debugging
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

app.use(errorHandler);

export default app;