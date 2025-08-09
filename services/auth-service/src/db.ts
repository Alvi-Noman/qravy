import { MongoClient } from 'mongodb';
import { env } from '../../../packages/config/validateEnv.js';

export const client = new MongoClient(env.MONGODB_URI!);