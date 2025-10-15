/**
 * Mongo client
 * - ignoreUndefined: drop undefined fields instead of writing null
 */
import { MongoClient } from 'mongodb';
import { env } from '@muvance/config/validateEnv';

export const client = new MongoClient(env.MONGODB_URI!, {
  ignoreUndefined: true,
});