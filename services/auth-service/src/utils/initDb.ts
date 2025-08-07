import { MongoClient } from 'mongodb';
import logger from './logger.js'; // Use your shared Winston logger

// Ensure required indexes exist on the users collection
export async function ensureUserIndexes(client: MongoClient) {
  const db = client.db('authDB');
  const users = db.collection('users');

  // Unique index on email for fast lookups and to prevent duplicates
  await users.createIndex({ email: 1 }, { unique: true });
  logger.info('Ensured unique index on users.email');

  // Index on magicLinkToken for fast magic link verification
  await users.createIndex({ magicLinkToken: 1 });
  logger.info('Ensured index on users.magicLinkToken');

  // (Optional) Index on isVerified for querying verified users
  // await users.createIndex({ isVerified: 1 });
  // logger.info('Ensured index on users.isVerified');
}