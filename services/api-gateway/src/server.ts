import app from './app.js';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(
    `API Gateway running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
  );
});

server.on('error', (err) => {
  console.error('API Gateway failed to start:', err.message);
  process.exit(1);
});

const shutdown = () => {
  console.log('Shutting down API Gateway...');
  server.close(() => {
    console.log('API Gateway closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);