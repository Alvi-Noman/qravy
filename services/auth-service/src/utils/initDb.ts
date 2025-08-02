import { MongoClient } from 'mongodb';

export async function ensureUserIndexes(client: MongoClient) {
  const db = client.db('authDB');
  const users = db.collection('users');

  // Unique index on email
  await users.createIndex({ email: 1 }, { unique: true });

  // Index on magicLinkToken
  await users.createIndex({ magicLinkToken: 1 });

  // (Optional) Index on isVerified
  // await users.createIndex({ isVerified: 1 });
}