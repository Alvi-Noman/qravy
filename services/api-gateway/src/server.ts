import app from './app.js';
import { config } from 'dotenv';
import logger from './utils/logger.js'; // Use your shared Winston logger

config();

// Ensure PORT is a number for app.listen
const PORT = Number(process.env.PORT) || 8080;

// Start the server and listen on 0.0.0.0 for Docker compatibility
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(
    `API Gateway running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
  );
});

server.on('error', (err) => {
  logger.error('API Gateway failed to start: ' + err.message);
  process.exit(1);
});

// Graceful shutdown for SIGTERM/SIGINT
const shutdown = () => {
  logger.info('Shutting down API Gateway...');
  server.close(() => {
    logger.info('API Gateway closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);