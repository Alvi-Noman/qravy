console.log('Starting auth service...');

import app from './app.js';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config();

console.log('Loaded modules and config.');

export const client = new MongoClient(process.env.MONGODB_URI!);

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Connected to MongoDB!');
    app.listen(PORT, () => {
      console.log(`Auth service running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

startServer();