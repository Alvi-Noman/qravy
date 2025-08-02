import { env } from '../../../packages/config/validateEnv.js';
import app from './app.js';
import { MongoClient } from 'mongodb';
import winston from 'winston';
import { ensureUserIndexes } from './utils/initDb.js'; // <-- Add this import

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [new winston.transports.Console()],
});

export const client = new MongoClient(env.MONGODB_URI!);

const PORT = env.PORT || 3001;

let server: ReturnType<typeof app.listen> | null = null;

async function startServer() {
  try {
    logger.info(`Starting in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info('Connecting to MongoDB...');
    await client.connect();
    logger.info('Connected to MongoDB!');

    // Ensure indexes
    await ensureUserIndexes(client);

    server = app.listen(PORT, () => {
      logger.info(`Auth service running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info(`${signal} received. Closing MongoDB connection...`);
  await client.close();
  logger.info('MongoDB connection closed.');
  if (server) {
    logger.info('Closing HTTP server...');
    server.close(() => {
      logger.info('HTTP server closed. Exiting process.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

startServer();