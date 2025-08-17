import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from './logger.js';

export type AuditEvent = {
  userId: string;
  action: string;
  before?: any;
  after?: any;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
};

export async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const col = client.db('authDB').collection('audits');
    await col.insertOne({
      ...event,
      userId: new ObjectId(event.userId),
      createdAt: new Date(),
    });
  } catch (e) {
    logger.warn(`Failed to write audit log: ${(e as Error).message}`);
  }
}