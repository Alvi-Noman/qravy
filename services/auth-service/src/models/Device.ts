import { ObjectId } from 'mongodb';

export type DeviceStatus = 'active' | 'pending' | 'revoked';
export type DeviceTrust = 'high' | 'medium' | 'low';

export interface DeviceDoc {
  _id?: ObjectId;

  tenantId: ObjectId;
  userId?: ObjectId | null;

  // Stable client-generated identifier (stored in localStorage/cookie)
  deviceKey: string;

  label?: string | null;

  // Basic client fingerprint
  os?: string | null;
  browser?: string | null;
  ua?: string | null;
  ip?: string | null;
  ipCountry?: string | null;

  // Assignment
  locationId?: ObjectId | null;

  // Security posture
  status: DeviceStatus;
  trust: DeviceTrust;

  createdAt: Date;
  updatedAt: Date;
  lastSeenAt?: Date;
}