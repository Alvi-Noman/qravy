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
import { REFRESH_COOKIE_OPTS } from './authController.js';
import { lockedBranch } from '../middleware/auth.js';
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
/** Inviting, re-inviting and removing team members: owners and admins only. */
function managesTeam(req: Request): boolean {
  const role = req.user?.role;
  return role === 'owner' || role === 'admin';
}

export const inviteAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const inviterEmail = req.user?.email;
    if (!tenantId) return void res.fail(409, 'Tenant not set');
    if (!inviterEmail) return void res.fail(401, 'Unauthorized');
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can invite people.');

    const { email, locationId } = req.body || {};
    if (!email || typeof email !== 'string') return void res.fail(400, 'Email is required');

    const normalizedEmail = email.trim().toLowerCase();
    const tenantObjectId = new ObjectId(tenantId);

    const tenant = await tenants().findOne({ _id: tenantObjectId });
    if (!tenant) return void res.fail(404, 'Tenant not found');

    // "<branch> only": one of this restaurant's open branches; none → every branch
    let branchOid: ObjectId | null = null;
    if (locationId) {
      if (typeof locationId !== 'string' || !ObjectId.isValid(locationId)) return void res.fail(400, 'Invalid branch');
      const loc = await getDb()
        .collection('locations')
        .findOne({ _id: new ObjectId(locationId), tenantId: tenantObjectId, disabled: { $ne: true } }, { projection: { _id: 1 } });
      if (!loc) return void res.fail(404, 'Branch not found');
      branchOid = loc._id as ObjectId;
    }

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
          locationId: branchOid, // null → every branch
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
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can invite people.');
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
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can remove people.');
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

    const users = getDb().collection('users');
    if (!invite) {
      // a link works once: opened again after it was accepted → say so (the page sends them to sign in); a reusable
      // link would let anyone it's forwarded to in for 7 days
      const existing = await users.findOne({ email });
      const member =
        existing &&
        (await memberships().findOne({ tenantId: new ObjectId(tenantId), userId: existing._id, status: 'active' }));
      if (member) return void res.fail(409, 'This invite was already accepted — sign in with your email.', { code: 'INVITE_USED' });
      return void res.fail(404, 'Invite not found or expired');
    }

    // Activate: ensure the user exists (the link proves the email), the membership, a session in the restaurant
    let user = await users.findOne({ email });
    if (!user) {
      const ins = await users.insertOne({ email, isVerified: true, refreshTokens: [], createdAt: new Date() });
      user = await users.findOne({ _id: ins.insertedId });
    }
    await acceptInvite(invite, user!._id as ObjectId);
    // (its refresh token is kept on the user and set in the login cookie — it used to be neither, so the session
    // ended at the first refresh)
    const { accessToken } = await startSession(req, res, user!, tenantId, { role: invite.role || 'admin' });

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
/**
 * PATCH /access/devices/:id { locationId } — move a device to another branch (from the owner's or an admin's own
 * device: a branch device can't move itself). DELETE /access/devices/:id — forget it (it signs in as a new device,
 * asked "Which location are you signing from?" again).
 */
export const updateDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can manage devices.');
    const tenantId = req.user?.tenantId;
    const { id } = req.params;
    const { locationId } = (req.body || {}) as { locationId?: string };
    if (!tenantId) return void res.fail(409, 'Tenant not set');
    if (!ObjectId.isValid(id) || !locationId || !ObjectId.isValid(locationId)) return void res.fail(400, 'Invalid device or branch');
    const tenantOid = new ObjectId(tenantId);
    const loc = await getDb()
      .collection('locations')
      .findOne({ _id: new ObjectId(locationId), tenantId: tenantOid, disabled: { $ne: true } }, { projection: { name: 1 } });
    if (!loc) return void res.fail(404, 'Branch not found');
    const r = await devices().updateOne(
      { _id: new ObjectId(id), tenantId: tenantOid },
      { $set: { locationId: loc._id as ObjectId, updatedAt: new Date() } }
    );
    if (!r.matchedCount) return void res.fail(404, 'Device not found');
    res.ok({ id, locationId, locationName: loc.name ?? null });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /access/devices/current — release THIS device from its branch: the way out for an owner or admin whose own
 * computer was set to a branch ("Which location are you signing from?"). Branch staff can't; the device then shows
 * every branch again for them.
 */
export const releaseCurrentDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can release a device.');
    const tenantId = req.user?.tenantId;
    // staff invited for one branch only (an admin role, limited to it) can't free a device either
    const limited = await memberships().findOne(
      { tenantId: new ObjectId(String(tenantId)), userId: new ObjectId(String(req.user?.id)), locationId: { $type: 'objectId' } },
      { projection: { _id: 1 } }
    );
    if (limited) return void res.fail(403, 'Only owners and admins can release a device.');
    const deviceKey = String(((req as any).cookies?.deviceKey as string | undefined) || '').trim();
    if (!tenantId || !deviceKey) return void res.fail(404, 'This device is not assigned to a branch');
    const r = await devices().deleteOne({ tenantId: new ObjectId(tenantId), deviceKey });
    if (!r.deletedCount) return void res.fail(404, 'This device is not assigned to a branch');
    res.ok({ released: true });
  } catch (err) {
    next(err);
  }
};

export const deleteDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!managesTeam(req)) return void res.fail(403, 'Only owners and admins can manage devices.');
    const tenantId = req.user?.tenantId;
    const { id } = req.params;
    if (!tenantId) return void res.fail(409, 'Tenant not set');
    if (!ObjectId.isValid(id)) return void res.fail(400, 'Invalid device');
    const r = await devices().deleteOne({ _id: new ObjectId(id), tenantId: new ObjectId(tenantId) });
    if (!r.deletedCount) return void res.fail(404, 'Device not found');
    res.ok({ id });
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
    // a device already locked to a branch stays there (re-confirming it is fine): moving it is done from the
    // owner's or an admin's own device, in Settings → Restaurant Access
    if (req.user?.sessionType === 'branch' && req.user?.locationId !== locationId) {
      return void res.fail(403, 'This device belongs to another branch.');
    }

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
    // no device key = this browser isn't one of a restaurant's devices — an answer, not an error (a 400 here once
    // made the login page skip the person's restaurant access and offer "create a restaurant")
    if (!deviceKey) return void res.ok({ found: false });
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

/** How someone is in a restaurant: its owner / a member (role from the membership), a Team invite not yet accepted,
 * or its Restaurant Access email (the restaurant's staff login). */
type Way = { via: 'own' | 'member' | 'invite' | 'access'; role?: string; invite?: Document };

async function wayIn(tenantId: ObjectId, userId: string, email: string): Promise<Way | null> {
  const t = await tenants().findOne({ _id: tenantId }, { projection: { ownerId: 1, accessSettings: 1 } });
  if (!t) return null;
  if (t.ownerId && String(t.ownerId) === userId) return { via: 'own', role: 'owner' };
  const m = await memberships().findOne({ tenantId, userId: new ObjectId(userId), status: 'active' });
  if (m) return { via: 'member', role: String(m.role) };
  const inv = await adminInvites().findOne({ tenantId, email, status: 'invited', inviteExpiresAt: { $gt: new Date() } });
  if (inv) return { via: 'invite', role: String(inv.role || 'admin'), invite: inv };
  if (String(t.accessSettings?.centralEmail || '').toLowerCase() === email) return { via: 'access' };
  return null;
}

/** A Team invite accepted: the person (who proved the email — the passcode / the link) becomes a member. */
async function acceptInvite(invite: Document, userId: ObjectId): Promise<void> {
  await memberships().updateOne(
    { tenantId: invite.tenantId, userId, status: 'active' },
    {
      $set: {
        role: invite.role || 'admin',
        status: 'active',
        // "<branch> only" → a branch login (that branch's orders, calls and menu switches); none → every branch
        locationId: invite.locationId ?? null,
        updatedAt: new Date(),
      },
      $setOnInsert: { tenantId: invite.tenantId, userId, createdAt: new Date() },
    },
    { upsert: true }
  );
  await adminInvites().deleteOne({ _id: invite._id });
}

/** A session in this restaurant: the access token + a refresh token kept on the user, in the login cookie
 * (path /api/v1/auth — the one refresh reads; this used to land elsewhere and the next refresh lost the restaurant). */
async function startSession(req: Request, res: Response, user: Document, tenantId: string, claims: Record<string, unknown>) {
  const userId = String(user._id);
  const email = String(user.email || '').toLowerCase();
  const lock = await lockedBranch(req, tenantId, userId);
  const accessToken = jwt.sign(
    { id: userId, email, tenantId, ...claims, sessionType: lock ? 'branch' : 'member', ...(lock ? { locationId: lock } : {}) },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );
  const refreshTokenValue = generateRefreshToken({ id: userId, email, tenantId, ...(claims.central ? { central: true } : {}) });
  const cleanedTokens = cleanupTokens(user.refreshTokens);
  cleanedTokens.push({
    tokenId: crypto.randomUUID(),
    tokenHash: hashToken(refreshTokenValue),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    userAgent: (req.headers['user-agent'] as string | undefined) || 'unknown',
    ip: (req.ip as string | undefined) || (req.socket?.remoteAddress as string | undefined) || 'unknown',
  });
  while (cleanedTokens.length > 5) cleanedTokens.shift();
  await getDb().collection('users').updateOne({ _id: user._id }, { $set: { refreshTokens: cleanedTokens } });
  res.cookie('refreshToken', refreshTokenValue, REFRESH_COOKIE_OPTS);
  return { accessToken, branch: lock };
}

/** Into one of the restaurants the person has access to (POST /access/select-tenant { tenantId }). */
export const selectTenant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const email = (req.user?.email || '').toLowerCase();
    const userId = req.user?.id;
    const { tenantId } = (req.body || {}) as { tenantId?: string };

    if (!email || !userId) return void res.fail(401, 'Unauthorized');
    if (!tenantId || !ObjectId.isValid(tenantId)) return void res.fail(400, 'tenantId is required');

    const user = await getDb().collection('users').findOne({ _id: new ObjectId(userId) });
    if (!user) return void res.fail(404, 'User not found');
    const way = await wayIn(new ObjectId(tenantId), userId, email);
    if (!way) return void res.fail(403, 'Not authorized for this tenant');

    if (way.via === 'invite') await acceptInvite(way.invite!, user._id as ObjectId);
    // a member / owner: their role there; Restaurant Access: `central` — staff permissions, re-checked on every refresh
    // so removing the email in Settings ends it
    const claims = way.via === 'access' ? { central: true } : { role: way.role };
    const { accessToken, branch } = await startSession(req, res, user, tenantId, claims);
    res.ok({ token: accessToken, via: way.via, role: way.role ?? null, branch });
  } catch (err) {
    next(err);
  }
};

/** Every restaurant this person can go into (the login's list): their own, memberships, Team invites waiting for
 * them, and Restaurant Access — one row each, own first. Empty when they only have their own (it just opens). */
export async function listAccessibleWorkspaces(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = (req.user?.email || '').toLowerCase();
    const userId = req.user?.id;
    if (!email || !userId || !ObjectId.isValid(userId)) return void res.fail(401, 'Unauthorized');
    const uid = new ObjectId(userId);
    const user = await getDb().collection('users').findOne({ _id: uid }, { projection: { tenantId: 1 } });
    const own = user?.tenantId ? String(user.tenantId) : null;

    const rows = new Map<string, { id: string; via: Way['via']; role: string | null }>();
    const add = (id: string, via: Way['via'], role: string | null) => {
      if (!rows.has(id)) rows.set(id, { id, via, role });
    };
    if (own) add(own, 'own', 'owner');
    for (const m of await memberships().find({ userId: uid, status: 'active' }, { projection: { tenantId: 1, role: 1 } }).toArray()) {
      add(String(m.tenantId), String(m.tenantId) === own ? 'own' : 'member', String(m.role));
    }
    const invites = await adminInvites()
      .find({ email, status: 'invited', inviteExpiresAt: { $gt: new Date() } }, { projection: { tenantId: 1, role: 1 } })
      .toArray();
    for (const i of invites) add(String(i.tenantId), 'invite', String(i.role || 'admin'));
    for (const t of await tenants().find({ 'accessSettings.centralEmail': email }, { projection: { _id: 1 } }).toArray()) {
      add(String(t._id), 'access', null);
    }

    const ids = [...rows.keys()].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const names = new Map(
      (await tenants().find({ _id: { $in: ids }, demo: { $exists: false } }, { projection: { name: 1 } }).toArray())
        .map((t) => [String(t._id), String(t.name || '')])
    );
    const items = [...rows.values()].filter((r) => names.has(r.id)).map((r) => ({ ...r, name: names.get(r.id)! }));
    // only their own restaurant → nothing to choose
    res.ok({ items: items.length === 1 && items[0].via === 'own' ? [] : items });
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

    const items: Array<{
      id: string;
      email: string;
      role: 'owner' | 'admin';
      status: 'active' | 'invited';
      /** "<branch> only" (null → every branch) */
      branchId?: string | null;
      branchName?: string | null;
    }> = [];
    const branchNames = new Map(
      (await getDb().collection('locations').find({ tenantId: tenantObjectId }, { projection: { name: 1 } }).toArray()).map(
        (l) => [String(l._id), String(l.name || '')]
      )
    );
    const branchOf = (id: unknown) =>
      id ? { branchId: String(id), branchName: branchNames.get(String(id)) ?? null } : { branchId: null, branchName: null };

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
      .project({ userId: 1, locationId: 1 })
      .toArray();
    const branchByUser = new Map(activeAdmins.map((m) => [String(m.userId), m.locationId]));

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
          ...branchOf(branchByUser.get(String(u._id))),
        });
      }
    }

    const invited = await adminInvites()
      .find({ tenantId: tenantObjectId, status: 'invited' })
      .project({ email: 1, _id: 1, locationId: 1 })
      .toArray();

    for (const inv of invited) {
      items.push({
        id: `invite:${String(inv._id)}`,
        email: String(inv.email).toLowerCase(),
        role: 'admin',
        status: 'invited',
        ...branchOf(inv.locationId),
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
  updateDevice,
  deleteDevice,
  releaseCurrentDevice,
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
