import { env } from '@qravy/config/validateEnv';
import app from './app.js';
import { MongoClient } from 'mongodb';
import logger from './utils/logger.js';
import { ensureUserIndexes } from './utils/initDb.js';
import { logEmailBootInfo } from './utils/email.js';

export const client = new MongoClient(env.MONGODB_URI!);

const PORT = Number(env.PORT) || 3001;

let server: ReturnType<typeof app.listen> | null = null;

async function startServer() {
  try {
    logger.info(`Starting in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info('Connecting to MongoDB...');
    await client.connect();
    logger.info('Connected to MongoDB!');

    // Ensure indexes exist for performance and reliability
    await ensureUserIndexes(client);

    // Listen on 0.0.0.0 for Docker compatibility
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Auth service running on port ${PORT}`);
      // Print email provider info at boot (helps diagnose 500s from mail)
      logEmailBootInfo();
    });
  } catch (err) {
    logger.error('Failed to connect to MongoDB:', err as Error);
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
