/**
 * Auth service app
 * - Rate limit (skips OPTIONS so preflights don't count)
 * - JSON, cookies, logging
 * - Routes + Dev 404 tracer
 * - Error handler
 */
import express, { Application, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import logger from './utils/logger.js';
import { responseFormatter } from './middleware/response.js';
import { errorHandler } from './middleware/errorHandler.js';

const app: Application = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

app.use(responseFormatter);

const authLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  limit: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV !== 'production',
});
app.use('/api/v1/auth', authLimiter);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth', menuRoutes);

if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1', (req: Request, res: Response) => {
    logger.warn(`[ROUTE 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found', path: req.originalUrl });
  });
}

app.use(errorHandler);

export default app;