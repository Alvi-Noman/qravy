import { errorHandler } from './middleware/errorHandler.js';
import express, { Application } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [new winston.transports.Console()],
});

const app: Application = express();

// Use CORS origin from environment variable, fallback to localhost for dev
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many requests, please try again later.' }
});

// Enable rate limiting for auth routes
app.use('/api/v1/auth', authLimiter);

app.use((req, res, next) => {
  logger.info(`[${req.method}] ${req.originalUrl}`);
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);

app.use(errorHandler);

export default app;