import { createLogger, format, transports } from 'winston';
import path from 'path';

// Custom log levels for better control and HTTP logging
const customLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3, // for Morgan HTTP logs
  debug: 4,
};

// Create a Winston logger with console and file transports
const logger = createLogger({
  levels: customLevels,
  level: process.env.LOG_LEVEL || 'info', // Configurable log level
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join('logs', 'error.log'), level: 'error' }),
    new transports.File({ filename: path.join('logs', 'combined.log') }),
  ],
});

export default logger;