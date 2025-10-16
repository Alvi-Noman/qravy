import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from './logger.js';

export type AuditEvent = {
  userId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
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
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`Failed to write audit log: ${msg}`);
  }
}