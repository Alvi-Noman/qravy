import type { Request, Response, NextFunction } from 'express';
import { client } from '../db.js';
import { Collection, Db, ObjectId } from 'mongodb';
import type { DeviceDoc } from '../models/Device.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateRefreshToken } from '../utils/token.js';

let db: Db | null = null;

const getDb = (): Db => {
  if (!db) db = client.db('authDB');
  return db!;
};

const tenants = (): Collection => getDb().collection('tenants');
const devices = (): Collection<DeviceDoc> => getDb().collection<DeviceDoc>('devices');
const locations = (): Collection => getDb().collection('locations');

const DEFAULT_ACCESS_SETTINGS = {
  centralEmail: '',
  emailVerified: false,
  enrollment: {
    requireOtpForNewDevice: true,
    requireManagerPinOnAssign: false,
    sessionDays: 30,
    autoApproveAssignment: true,
  },
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function cleanupTokens(tokens: any[] | undefined): any[] {
  const now = new Date();
  return (tokens ?? []).filter((t) => t.expiresAt > now);
}

export const getAccessSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const t = await tenants().findOne({ _id: new ObjectId(tenantId) });
    const item = (t?.accessSettings as unknown) || DEFAULT_ACCESS_SETTINGS;
    res.ok({ item });
  } catch (err) {
    next(err);
  }
};

export const updateAccessSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const payload = req.body || {};
    const centralEmail =
      typeof payload.centralEmail === 'string' ? String(payload.centralEmail).trim().toLowerCase() : '';

    const nextSettings = {
      ...DEFAULT_ACCESS_SETTINGS,
      ...payload,
      centralEmail,
      emailVerified: Boolean(payload.emailVerified ?? false),
      enrollment: {
        ...DEFAULT_ACCESS_SETTINGS.enrollment,
        ...(payload.enrollment || {}),
      },
    };

    await tenants().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { accessSettings: nextSettings, updatedAt: new Date() } }
    );

    res.ok({ item: nextSettings });
  } catch (err) {
    next(err);
  }
};

export const listDevices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const list = await devices()
      .find({ tenantId: new ObjectId(tenantId) })
      .sort({ updatedAt: -1 })
      .toArray();

    const locIds = Array.from(new Set(list.map((d) => d.locationId).filter(Boolean) as ObjectId[]));
    const locMap =
      locIds.length > 0
        ? await locations()
            .find({ _id: { $in: locIds } })
            .project({ name: 1 })
            .toArray()
            .then((arr) => Object.fromEntries(arr.map((l) => [String(l._id), l.name])))
        : {};

    const items = list.map((d) => ({
      id: String(d._id),
      label: d.label ?? null,
      os: d.os ?? null,
      browser: d.browser ?? null,
      lastSeenAt: (d.lastSeenAt ?? d.updatedAt ?? d.createdAt).toISOString(),
      createdAt: (d.createdAt ?? new Date()).toISOString(),
      locationId: d.locationId ? String(d.locationId) : null,
      locationName: d.locationId ? locMap[String(d.locationId)] ?? null : null,
      status: d.status,
      trust: d.trust,
      ipCountry: d.ipCountry ?? null,
    }));

    res.ok({ items });
  } catch (err) {
    next(err);
  }
};

export const registerOrAssignDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const { deviceKey, locationId, label, os, browser } = req.body as {
      deviceKey?: string;
      locationId?: string;
      label?: string;
      os?: string;
      browser?: string;
    };

    if (!deviceKey || typeof deviceKey !== 'string') return void res.fail(400, 'deviceKey is required');
    if (!locationId || typeof locationId !== 'string') return void res.fail(400, 'locationId is required');

    const tenantObjectId = new ObjectId(tenantId);
    const locationObjectId = new ObjectId(locationId);

    const ip = (req.ip as string | undefined) || (req.socket?.remoteAddress as string | undefined) || undefined;
    const ua = (req.headers['user-agent'] as string | undefined) || undefined;

    const now = new Date();

    const update = {
      $setOnInsert: {
        createdAt: now,
        status: 'active' as const,
        trust: 'high' as const,
        tenantId: tenantObjectId,
        userId: req.user?.id ? new ObjectId(req.user.id) : null,
        deviceKey,
      },
      $set: {
        updatedAt: now,
        lastSeenAt: now,
        locationId: locationObjectId,
        label: label ?? null,
        os: os ?? null,
        browser: browser ?? null,
        ua: ua ?? null,
        ip: ip ?? null,
      },
    };

    await devices().updateOne({ tenantId: tenantObjectId, deviceKey }, update, { upsert: true });

    const doc = await devices().findOne({ tenantId: tenantObjectId, deviceKey });
    if (!doc) return void res.fail(500, 'Failed to register device');

    res.ok({
      item: {
        id: String(doc._id),
        label: doc.label ?? null,
        os: doc.os ?? null,
        browser: doc.browser ?? null,
        lastSeenAt: (doc.lastSeenAt ?? doc.updatedAt ?? doc.createdAt).toISOString(),
        createdAt: (doc.createdAt ?? now).toISOString(),
        locationId: doc.locationId ? String(doc.locationId) : null,
        status: doc.status,
        trust: doc.trust,
        ipCountry: doc.ipCountry ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * One-time login fast path: look up assignment by deviceKey across tenants.
 * Returns { found, tenantId, locationId, locationName } only if this email is authorized for that tenant.
 */
export const lookupDeviceByKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deviceKey = String((req.query.deviceKey as string) || '').trim();
    const email = (req.user?.email || '').toLowerCase();
    if (!deviceKey) return void res.fail(400, 'deviceKey is required');
    if (!email) return void res.fail(401, 'Unauthorized');

    const d = await devices().findOne({ deviceKey });
    if (!d) return void res.ok({ found: false });

    const t = await tenants().findOne({ _id: d.tenantId });
    const central = String((t as any)?.accessSettings?.centralEmail || '').toLowerCase();
    if (!central || central !== email) return void res.ok({ found: false });

    let locationName: string | null = null;
    if (d.locationId) {
      const loc = await locations().findOne({ _id: d.locationId });
      locationName = (loc?.name as string) || null;
    }

    return void res.ok({
      found: true,
      tenantId: String(d.tenantId),
      locationId: d.locationId ? String(d.locationId) : null,
      locationName,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Issue a new access token AND a tenant-bound refresh token after user selects a workspace.
 */
export const selectTenant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const email = (req.user?.email || '').toLowerCase();
    const userId = req.user?.id;
    const { tenantId } = (req.body || {}) as { tenantId?: string };

    if (!email || !userId) return void res.fail(401, 'Unauthorized');
    if (!tenantId) return void res.fail(400, 'tenantId is required');

    const t = await tenants().findOne({ _id: new ObjectId(tenantId) });
    if (!t) return void res.fail(404, 'Tenant not found');

    const centralEmail = ((t as any)?.accessSettings?.centralEmail || '').toLowerCase();
    if (!centralEmail || centralEmail !== email) return void res.fail(403, 'Not authorized for this tenant');

    const accessToken = jwt.sign({ id: userId, email, tenantId }, process.env.JWT_SECRET as string, {
      expiresIn: '15m',
    });

    const db = getDb();
    const users = db.collection('users');

    const refreshTokenValue = generateRefreshToken({ id: userId, email, tenantId });
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = hashToken(refreshTokenValue);

    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) return void res.fail(404, 'User not found');

    const cleanedTokens = cleanupTokens(user.refreshTokens);
    const userAgent = (req.headers['user-agent'] as string | undefined) || 'unknown';
    const ip = (req.ip as string | undefined) || (req.socket?.remoteAddress as string | undefined) || 'unknown';

    cleanedTokens.push({ tokenId, tokenHash, createdAt: new Date(), expiresAt, userAgent, ip });
    while (cleanedTokens.length > 5) cleanedTokens.shift();

    await users.updateOne({ _id: new ObjectId(userId) }, { $set: { refreshTokens: cleanedTokens } });

    res.cookie('refreshToken', refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.ok({ token: accessToken });
  } catch (err) {
    next(err);
  }
};

export default {
  getAccessSettings,
  updateAccessSettings,
  listDevices,
  registerOrAssignDevice,
  listAccessibleWorkspaces: async (req: Request, res: Response, next: NextFunction) =>
    listAccessibleWorkspaces(req, res, next),
  selectTenant,
  lookupDeviceByKey,
};

async function listAccessibleWorkspaces(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = (req.user?.email || '').toLowerCase();
    if (!email) return void res.fail(401, 'Unauthorized');
    const cursor = tenants().find({ 'accessSettings.centralEmail': email }).project({ name: 1 });
    const items = (await cursor.toArray()).map((t) => ({ id: String(t._id), name: t.name as string }));
    res.ok({ items });
  } catch (err) {
    next(err);
  }
}