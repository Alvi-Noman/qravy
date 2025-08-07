import { errorHandler } from './middleware/errorHandler.js';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import logger from './utils/logger.js';
import morgan from 'morgan';

const app: Application = express();

// Use CORS origin from env for frontend dev/prod flexibility
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(cookieParser());

// Integrate Morgan for HTTP request logging, pipe to Winston
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.http(message.trim())
  }
}));

// Rate limit auth endpoints to prevent abuse, using .env config
const authLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 20,
  message: { message: 'Too many requests, please try again later.' }
});
app.use('/api/v1/auth', authLimiter);

// Log every request, including user info if available
app.use((req: Request, res: Response, next: NextFunction) => {
  if ((req as any).user) {
    logger.info(`[${req.method}] ${req.originalUrl} by user: ${(req as any).user.email || (req as any).user.id}`);
  } else {
    logger.info(`[${req.method}] ${req.originalUrl} by anonymous user`);
  }
  next();
});

// Health check endpoint for monitoring
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Main auth API routes
app.use('/api/v1/auth', authRoutes);

// Centralized error handler
app.use(errorHandler);

export default app;