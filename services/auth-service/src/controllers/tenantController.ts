import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { UserDoc } from '../models/User.js';
import type { MembershipDoc } from '../models/Membership.js';
import { auditLog } from '../utils/audit.js';
import { toTenantDTO } from '../utils/mapper.js';

function tenantsCol() {
  return client.db('authDB').collection<TenantDoc>('tenants');
}
function usersCol() {
  return client.db('authDB').collection<UserDoc>('users');
}
function membershipsCol() {
  return client.db('authDB').collection<MembershipDoc>('memberships');
}

// Allowed final plan ids
const ALLOWED_PLAN_IDS = ['p1_m', 'p1_y', 'p2_m', 'p2_y'] as const;
type AllowedPlanId = (typeof ALLOWED_PLAN_IDS)[number];

// Legacy/base mapping to tier
// supports: p1/p2, starter/pro (if you ever send those from the client)
const LEGACY_BASE_MAP: Record<string, 'p1' | 'p2'> = {
  p1: 'p1',
  p2: 'p2',
  starter: 'p1',
  pro: 'p2',
};

// Normalize any incoming plan to p1_m/p1_y/p2_m/p2_y
function normalizePlanId(input?: unknown, intervalInput?: unknown): AllowedPlanId | null {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();

  // Already in canonical form?
  if ((ALLOWED_PLAN_IDS as readonly string[]).includes(raw)) return raw as AllowedPlanId;

  // Try to parse suffix (_m/_y, :m/:y, _month/_year, monthly/yearly)
  const isYearSuffix = /(_y|_year|:y|:year|year|yearly)$/.test(raw);
  const isMonthSuffix = /(_m|_month|:m|:month|month|monthly)$/.test(raw);

  const baseRaw = raw.replace(/(_m|_y|_month|_year|:m|:y|:month|:year|month|monthly|year|yearly)$/g, '');
  const base = LEGACY_BASE_MAP[baseRaw] ?? baseRaw;

  let suffix: 'm' | 'y' | null = null;
  if (isYearSuffix) suffix = 'y';
  else if (isMonthSuffix) suffix = 'm';
  else {
    // fall back to intervalInput (if client sends a separate field)
    const intervalStr = String(intervalInput ?? '').trim().toLowerCase();
    if (intervalStr === 'year' || intervalStr === 'y' || intervalStr === 'yearly') suffix = 'y';
    if (intervalStr === 'month' || intervalStr === 'm' || intervalStr === 'monthly') suffix = 'm';
  }

  // Default to monthly if no suffix info is present
  if (!suffix) suffix = 'm';

  const normalized = `${base}_${suffix}`;
  return (ALLOWED_PLAN_IDS as readonly string[]).includes(normalized) ? (normalized as AllowedPlanId) : null;
}

// Trial config (default 3 days; override via TRIAL_DAYS)
const DEFAULT_TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 3);
const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export async function createTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.fail(401, 'Unauthorized');

    // Ensure single tenant per user
    const user = await usersCol().findOne({ _id: new ObjectId(userId) });
    if (user?.tenantId) {
      return res.fail(400, 'User already has a tenant. Only one restaurant allowed.');
    }

    const { name, subdomain } = req.body as { name: string; subdomain: string };
    const cleanName = String(name || '').trim();
    const cleanSub = String(subdomain || '').trim().toLowerCase();

    if (!cleanName) return res.fail(400, 'Name is required');
    if (!/^[a-z0-9-]{3,32}$/.test(cleanSub) || cleanSub.startsWith('-') || cleanSub.endsWith('-') || /--/.test(cleanSub)) {
      return res.fail(400, 'Invalid subdomain');
    }

    const exists = await tenantsCol().findOne({ subdomain: cleanSub });
    if (exists) return res.fail(409, 'Subdomain already taken');

    const now = new Date();
    const doc: TenantDoc = {
      name: cleanName,
      subdomain: cleanSub,
      ownerId: new ObjectId(userId),
      onboardingCompleted: false,

      // Initialize trial
      trialStartedAt: now,
      trialEndsAt: addDays(now, DEFAULT_TRIAL_DAYS),

      // Initialize subscription status
      subscriptionStatus: 'none',

      createdAt: now,
      updatedAt: now,
    };

    const ins = await tenantsCol().insertOne(doc);
    const created: TenantDoc = { ...doc, _id: ins.insertedId };

    // Register owner as active member
    const member: MembershipDoc = {
      tenantId: ins.insertedId,
      userId: new ObjectId(userId),
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await membershipsCol().insertOne(member);

    // Link tenant to user
    await usersCol().updateOne({ _id: new ObjectId(userId) }, { $set: { tenantId: ins.insertedId } });

    // Audit log
    await auditLog({
      userId,
      action: 'TENANT_CREATE',
      after: toTenantDTO(created),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(created) }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`createTenant error: ${msg}`);
    next(err);
  }
}

export async function getMyTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId;
    if (!userId) return res.fail(401, 'Unauthorized');
    if (!tenantId) return res.fail(404, 'Tenant not set');

    const tenant = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!tenant) return res.fail(404, 'Tenant not found');

    // Backfill trial dates & subscription status for legacy tenants
    const updates: Partial<TenantDoc> = {};
    const start = tenant.trialStartedAt ?? tenant.createdAt ?? new Date();
    if (!tenant.trialStartedAt) updates.trialStartedAt = start;
    if (!tenant.trialEndsAt) updates.trialEndsAt = addDays(start, DEFAULT_TRIAL_DAYS);
    if (!tenant.subscriptionStatus) updates.subscriptionStatus = 'none';

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await tenantsCol().updateOne({ _id: new ObjectId(tenantId) }, { $set: updates });
      tenant.trialStartedAt = updates.trialStartedAt ?? tenant.trialStartedAt;
      tenant.trialEndsAt = updates.trialEndsAt ?? tenant.trialEndsAt;
      tenant.subscriptionStatus = updates.subscriptionStatus ?? tenant.subscriptionStatus;
      tenant.updatedAt = updates.updatedAt ?? tenant.updatedAt;
    }

    return res.ok({ item: toTenantDTO(tenant) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`getMyTenant error: ${msg}`);
    next(err);
  }
}

export async function saveOnboardingStep(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(400, 'No tenant found');

    const { step, data } = req.body as { step: string; data: any };

    const update: Partial<TenantDoc> = {};
    if (step === 'owner') update.ownerInfo = data;
    if (step === 'restaurant') update.restaurantInfo = data;

    if (step === 'plan') {
      // Normalize to one of p1_m, p1_y, p2_m, p2_y
      const normalized = normalizePlanId(data?.planId, data?.interval);
      if (!normalized) {
        return res.fail(400, 'Invalid planId. Use one of p1_m, p1_y, p2_m, p2_y.');
      }

      update.planInfo = { planId: normalized };
      update.onboardingCompleted = true;

      // Ensure trials exist (legacy safeguard)
      const t = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
      if (t && (!t.trialStartedAt || !t.trialEndsAt)) {
        const start = t.trialStartedAt ?? t.createdAt ?? new Date();
        const end = t.trialEndsAt ?? addDays(start, DEFAULT_TRIAL_DAYS);
        update.trialStartedAt = start;
        update.trialEndsAt = end;
      }
    }

    await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { ...update, updatedAt: new Date() } }
    );

    return res.ok({ message: `${step} saved` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`saveOnboardingStep error: ${msg}`);
    next(err);
  }
}

// NEW: End trial early — uses updateOne + findOne to avoid TS issues with .value
export async function endTrialEarly(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const now = new Date();
    const upd = await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { trialEndsAt: now, updatedAt: now } }
    );

    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: 'TENANT_TRIAL_END',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(updated) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`endTrialEarly error: ${msg}`);
    next(err);
  }
}

// NEW: Subscribe (activate subscription and end trial) — updateOne + findOne pattern
export async function subscribeTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const { planId, interval } = req.body as { planId?: string; interval?: string };

    let planUpdate: TenantDoc['planInfo'] | undefined;
    if (planId) {
      const normalized = normalizePlanId(planId, interval);
      if (!normalized) return res.fail(400, 'Invalid planId. Use one of p1_m, p1_y, p2_m, p2_y.');
      planUpdate = { planId: normalized };
    }

    const now = new Date();
    const $set: Partial<TenantDoc> = {
      subscriptionStatus: 'active',
      trialEndsAt: now,
      updatedAt: now,
    };
    if (planUpdate) $set.planInfo = planUpdate;

    const upd = await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set }
    );

    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: 'TENANT_SUBSCRIBE',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(updated) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`subscribeTenant error: ${msg}`);
    next(err);
  }
}