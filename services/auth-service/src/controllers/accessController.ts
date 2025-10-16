/**
 * Access Controller
 * Handles tenant access settings, device assignments, and admin invitations.
 */

import type { Request, Response, NextFunction } from 'express';
import { client } from '../db.js';
import { Db, ObjectId, type Document, type Collection as MongoCollection } from 'mongodb';
import type { DeviceDoc } from '../models/Device.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateRefreshToken, generateInviteToken } from '../utils/token.js';
import { sendAdminInviteEmail } from '../utils/email.js';

let db: Db | null = null;

/** Get MongoDB connection */
const getDb = (): Db => {
  if (!db) db = client.db('authDB');
  return db!;
};

/** MongoDB collections with correct typing */
const tenants = (): MongoCollection<Document> => getDb().collection<Document>('tenants');
const devices = (): MongoCollection<DeviceDoc> => getDb().collection<DeviceDoc>('devices');
const locations = (): MongoCollection<Document> => getDb().collection<Document>('locations');

/**
 * NOTE: Use a separate collection for email-only admin invites to avoid
 * memberships validator (which may require userId:ObjectId).
 */
const adminInvites = (): MongoCollection<Document> => getDb().collection<Document>('adminInvites');

/** Memberships: used to persist RBAC once the invite is accepted */
const memberships = (): MongoCollection<Document> => getDb().collection<Document>('memberships');

/** Default access configuration */
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

/** Frontend URL + invite link builder (match magic-link pattern) */
const FRONTEND_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const buildInviteLink = (token: string) =>
  `${FRONTEND_URL}/magic-link?token=${encodeURIComponent(token)}`;

/** Hash token using SHA-256 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Clean up expired tokens */
function cleanupTokens(tokens: any[] | undefined): any[] {
  const now = new Date();
  return (tokens ?? []).filter((t) => t.expiresAt > now);
}

// ———————————————————————————————————————————————————————————————
// ADMIN INVITE
// ———————————————————————————————————————————————————————————————

/** Invite an Admin user (Owner only) */
export const inviteAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const inviterEmail = req.user?.email;
    if (!tenantId) return void res.fail(409, 'Tenant not set');
    if (!inviterEmail) return void res.fail(401, 'Unauthorized');

    const { email } = req.body || {};
    if (!email || typeof email !== 'string') return void res.fail(400, 'Email is required');

    const normalizedEmail = email.trim().toLowerCase();
    const tenantObjectId = new ObjectId(tenantId);

    const tenant = await tenants().findOne({ _id: tenantObjectId });
    if (!tenant) return void res.fail(404, 'Tenant not found');

    const tenantName = (tenant as any).name || 'Your Restaurant';

    // Generate invite token
    const inviteToken = generateInviteToken({ email: normalizedEmail, tenantId });
    const inviteTokenHash = hashToken(inviteToken);
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const now = new Date();

    // Upsert into adminInvites (email-only, safe from memberships validator)
    await adminInvites().updateOne(
      { tenantId: tenantObjectId, email: normalizedEmail },
      {
        $set: {
          role: 'admin',
          status: 'invited',
          inviteTokenHash,
          inviteExpiresAt,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    // Email link -> use magic-link style
    const inviteLink = buildInviteLink(inviteToken);
    await sendAdminInviteEmail(normalizedEmail, inviteLink, tenantName);

    res.ok({ success: true, message: 'Admin invite sent successfully.' });
  } catch (err: any) {
    // Surface validation error text if present
    res.fail(500, err?.message || 'Failed to send invite');
  }
};

/** Resend Admin invite (Owner only) */
export const resendInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { email } = req.body || {};
    if (!tenantId || !email) return void res.fail(400, 'Missing required fields');

    const normalizedEmail = email.trim().toLowerCase();
    const invite = await adminInvites().findOne({
      tenantId: new ObjectId(tenantId),
      email: normalizedEmail,
      status: 'invited',
    });
    if (!invite) return void res.fail(404, 'No pending invite found');

    const tenant = await tenants().findOne({ _id: new ObjectId(tenantId) });
    const tenantName = (tenant as any)?.name || 'Your Restaurant';

    const inviteToken = generateInviteToken({ email: normalizedEmail, tenantId });
    const inviteTokenHash = hashToken(inviteToken);
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await adminInvites().updateOne(
      { _id: invite._id },
      { $set: { inviteTokenHash, inviteExpiresAt, updatedAt: new Date() } }
    );

    const inviteLink = buildInviteLink(inviteToken);
    await sendAdminInviteEmail(normalizedEmail, inviteLink, tenantName);

    res.ok({ success: true, message: 'Invite resent successfully.' });
  } catch (err: any) {
    res.fail(500, err?.message || 'Failed to resend invite');
  }
};

/** Revoke Admin invite (or remove pending admin) */
export const revokeAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { email } = req.body || {};
    if (!tenantId || !email) return void res.fail(400, 'Missing required fields');

    const normalizedEmail = String(email).trim().toLowerCase();
    const tenantObjectId = new ObjectId(tenantId);

    // 1) Try to revoke a PENDING invite first
    const inviteDel = await adminInvites().deleteOne({
      tenantId: tenantObjectId,
      email: normalizedEmail,
      status: 'invited',
    });
    if (inviteDel.deletedCount > 0) {
      return void res.ok({ success: true, message: 'Admin invite revoked.' });
    }

    // 2) Otherwise, remove ACTIVE admin membership
    const users = getDb().collection('users');
    const user = await users.findOne({ email: normalizedEmail });
    if (!user?._id) return void res.fail(404, 'No such pending invite or admin user found');

    // Do not allow removing the Owner (central email)
    const tenantDoc = await tenants().findOne({ _id: tenantObjectId });
    const ownerEmail = String((tenantDoc as any)?.accessSettings?.centralEmail || '').toLowerCase();
    if (ownerEmail && ownerEmail === normalizedEmail) {
      return void res.fail(403, 'Owner cannot be removed');
    }

    // Prefer soft revoke for audit; listAdmins only shows status: 'active', so revoked won't appear
    const memFilter = { tenantId: tenantObjectId, userId: user._id, role: 'admin', status: 'active' as const };

    const memUpd = await memberships().updateOne(memFilter, {
      $set: { status: 'revoked', updatedAt: new Date() },
    });

    // If you prefer hard delete, swap the update above with:
    // const memDel = await memberships().deleteOne(memFilter);

    if (memUpd.modifiedCount === 1 /* || memDel.deletedCount === 1 */) {
      return void res.ok({ success: true, message: 'Admin access revoked.' });
    }

    return void res.fail(404, 'No such admin found for this tenant');
  } catch (err: any) {
    res.fail(500, err?.message || 'Failed to revoke admin');
  }
};

/** Confirm Admin invite (via email link) */
export const confirmInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Accept both ?token= and ?inviteToken= for flexibility
    const rawToken =
      (typeof req.query.token === 'string' && req.query.token) ||
      (typeof req.query.inviteToken === 'string' && req.query.inviteToken);
    if (!rawToken) return void res.fail(400, 'Invalid invite token');

    const { verifyInviteToken } = await import('../utils/token.js');
    let payload: any;
    try {
      payload = verifyInviteToken(rawToken);
    } catch {
      return void res.fail(400, 'Invalid or expired invite token');
    }

    const { email, tenantId } = payload;
    if (!email || !tenantId) return void res.fail(400, 'Invalid invite data');

    const inviteTokenHash = hashToken(rawToken);
    const invite = await adminInvites().findOne({
      tenantId: new ObjectId(tenantId),
      email,
      inviteTokenHash,
      status: 'invited',
    });

    if (!invite) return void res.fail(404, 'Invite not found or expired');

    // Activate: remove invite, ensure user exists, persist membership, mint tokens
    await adminInvites().deleteOne({ _id: invite._id });

    const users = getDb().collection('users');
    let user = await users.findOne({ email });
    if (!user) {
      const ins = await users.insertOne({
        email,
        isVerified: true,
        tenantId: new ObjectId(tenantId),
        refreshTokens: [],
        createdAt: new Date(),
      });
      user = await users.findOne({ _id: ins.insertedId });
    }

    // Persist RBAC so future refreshes resolve to admin
    await memberships().updateOne(
      { tenantId: new ObjectId(tenantId), userId: new ObjectId(user!._id), status: 'active' },
      {
        $set: {
          role: 'admin',
          status: 'active',
          updatedAt: new Date(),
        },
        $setOnInsert: {
          tenantId: new ObjectId(tenantId),
          userId: new ObjectId(user!._id),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    const accessToken = jwt.sign(
      { id: user!._id.toString(), email, tenantId, role: 'admin', sessionType: 'member' },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    );

    const refreshTokenValue = generateRefreshToken({
      id: user!._id.toString(),
      email,
      tenantId,
    });

    res.cookie('refreshToken', refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.ok({
      message: 'Invite confirmed successfully',
      token: accessToken,
      user: {
        id: user!._id.toString(),
        email,
        tenantId,
        role: 'admin',
        sessionType: 'member',
      },
    });
  } catch (err: any) {
    res.fail(500, err?.message || 'Failed to confirm invite');
  }
};

// ———————————————————————————————————————————————————————————————
// EXISTING CONTROLLERS
// ———————————————————————————————————————————————————————————————

/** Get access settings */
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

/** Update access settings */
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

/** List devices under tenant */
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
            .then((arr) => Object.fromEntries(arr.map((l) => [String(l._id), l.name])) as Record<string, string>)
        : ({} as Record<string, string>);

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

/** Register or assign device */
export const registerOrAssignDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const { deviceKey: bodyDeviceKey, locationId, label, os, browser } = (req.body || {}) as {
      deviceKey?: string;
      locationId?: string;
      label?: string;
      os?: string;
      browser?: string;
    };

    if (!locationId || typeof locationId !== 'string') return void res.fail(400, 'locationId is required');

    const cookies = (req as any).cookies as Record<string, string> | undefined;
    const cookieDeviceKey = (cookies?.deviceKey || '').trim();
    let deviceKey = cookieDeviceKey || (typeof bodyDeviceKey === 'string' ? bodyDeviceKey.trim() : '');

    if (!deviceKey) {
      deviceKey = crypto.randomUUID();
      res.cookie('deviceKey', deviceKey, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    } else if (!cookieDeviceKey) {
      res.cookie('deviceKey', deviceKey, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
    }

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

/** Lookup device by key */
export const lookupDeviceByKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cookies = (req as any).cookies as Record<string, string> | undefined;
    const cookieDeviceKey = (cookies?.deviceKey || '').trim();
    const queryDeviceKey = String((req.query.deviceKey as string) || '').trim();
    const deviceKey = cookieDeviceKey || queryDeviceKey;

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

/** Issue a new access token AND a tenant-bound refresh token after user selects a workspace. */
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

/** List accessible workspaces */
export async function listAccessibleWorkspaces(req: Request, res: Response, next: NextFunction): Promise<void> {
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

/** List Admin team (owner + active admins + invited emails) */
export const listAdmins = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return void res.fail(409, 'Tenant not set');

    const tenantObjectId = new ObjectId(tenantId);
    const users = getDb().collection('users');

    const tenantDoc = await tenants().findOne({ _id: tenantObjectId });
    const ownerEmail = String((tenantDoc as any)?.accessSettings?.centralEmail || '').toLowerCase();

    const items: Array<{ id: string; email: string; role: 'owner' | 'admin'; status: 'active' | 'invited' }> = [];

    if (ownerEmail) {
      const ownerUser = await users.findOne({ email: ownerEmail });
      items.push({
        id: ownerUser ? String(ownerUser._id) : `owner:${ownerEmail}`,
        email: ownerEmail,
        role: 'owner',
        status: 'active',
      });
    }

    const activeAdmins = await memberships()
      .find({ tenantId: tenantObjectId, role: 'admin', status: 'active' })
      .project({ userId: 1 })
      .toArray();

    const adminUserIds = activeAdmins.map((m) => m.userId).filter(Boolean);
    if (adminUserIds.length) {
      const adminUsers = await users.find({ _id: { $in: adminUserIds } }).project({ email: 1 }).toArray();
      for (const u of adminUsers) {
        if (!u?.email) continue;
        items.push({
          id: String(u._id),
          email: String(u.email).toLowerCase(),
          role: 'admin',
          status: 'active',
        });
      }
    }

    const invited = await adminInvites()
      .find({ tenantId: tenantObjectId, status: 'invited' })
      .project({ email: 1, _id: 1 })
      .toArray();

    for (const inv of invited) {
      items.push({
        id: `invite:${String(inv._id)}`,
        email: String(inv.email).toLowerCase(),
        role: 'admin',
        status: 'invited',
      });
    }

    res.ok({ items });
  } catch (err) {
    next(err);
  }
};

// ———————————————————————————————————————————————————————————————
// EXPORT DEFAULT
// ———————————————————————————————————————————————————————————————
export default {
  getAccessSettings,
  updateAccessSettings,
  listDevices,
  registerOrAssignDevice,
  listAccessibleWorkspaces: async (req: Request, res: Response, next: NextFunction) =>
    listAccessibleWorkspaces(req, res, next),
  selectTenant,
  lookupDeviceByKey,
  inviteAdmin,
  resendInvite,
  revokeAdmin,
  confirmInvite,
  listAdmins,
};
