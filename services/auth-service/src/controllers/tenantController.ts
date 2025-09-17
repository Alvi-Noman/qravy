// services/auth-service/src/controllers/tenantController.ts
import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { UserDoc } from '../models/User.js';
import type { MembershipDoc } from '../models/Membership.js';
import { auditLog } from '../utils/audit.js';
import { toTenantDTO } from '../utils/mapper.js';
import type { v1 } from '../../../../packages/shared/src/types/index.js';

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
  if ((ALLOWED_PLAN_IDS as readonly string[]).includes(raw)) return raw as AllowedPlanId;

  const isYearSuffix = /(_y|_year|:y|:year|year|yearly)$/.test(raw);
  const isMonthSuffix = /(_м|_m|_month|:m|:month|month|monthly)$/.test(raw);

  const baseRaw = raw.replace(/(_m|_y|_month|_year|:m|:y|:month|:year|month|monthly|year|yearly)$/g, '');
  const base = LEGACY_BASE_MAP[baseRaw] ?? baseRaw;

  let suffix: 'm' | 'y' | null = null;
  if (isYearSuffix) suffix = 'y';
  else if (isMonthSuffix) suffix = 'm';
  else {
    const intervalStr = String(intervalInput ?? '').trim().toLowerCase();
    if (intervalStr === 'year' || intervalStr === 'y' || intervalStr === 'yearly') suffix = 'y';
    if (intervalStr === 'month' || intervalStr === 'm' || intervalStr === 'monthly') suffix = 'm';
  }
  if (!suffix) suffix = 'm';

  const normalized = `${base}_${suffix}`;
  return (ALLOWED_PLAN_IDS as readonly string[]).includes(normalized) ? (normalized as AllowedPlanId) : null;
}

// Trial config
const DEFAULT_TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 3);
const DAY_MS = 24 * 60 * 60 * 1000;
function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

// Payment meta
type PaymentMeta = NonNullable<TenantDoc['payment']>;
type PaymentBrand = PaymentMeta['brand'];
type PaymentFunding = PaymentMeta['funding'];
type PaymentProvider = PaymentMeta['provider'];

function hasPaymentOnFile(p?: TenantDoc['payment']): boolean {
  return !!(p && (p.defaultPaymentMethodId || (p.brand && p.last4)));
}

/* ----------------------------- Billing profile helpers ----------------------------- */
function toBillingProfileDTO(bp?: TenantDoc['billingProfile']): v1.BillingProfileDTO | undefined {
  if (!bp) return undefined;
  return {
    companyName: bp.companyName,
    billingEmail: bp.billingEmail,
    extraEmails: bp.extraEmails ?? [],
    address: {
      line1: bp.address.line1,
      line2: bp.address.line2,
      city: bp.address.city,
      state: bp.address.state,
      postalCode: bp.address.postalCode,
      country: bp.address.country,
    },
    taxId: bp.taxId,
    taxExempt: bp.taxExempt ?? 'none',
    dunningEnabled: typeof bp.dunningEnabled === 'boolean' ? bp.dunningEnabled : true,
    dunningDays: bp.dunningDays ?? [3, 7, 14],
    updatedAt: bp.updatedAt instanceof Date ? bp.updatedAt.toISOString() : bp.updatedAt,
  };
}

/* ------------------------------------ Handlers ------------------------------------ */

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
      trialStartedAt: now,
      trialEndsAt: addDays(now, DEFAULT_TRIAL_DAYS),
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

    // Backfills
    const updates: Partial<TenantDoc> = {};
    const start = tenant.trialStartedAt ?? tenant.createdAt ?? new Date();
    if (!tenant.trialStartedAt) updates.trialStartedAt = start;
    if (!tenant.trialEndsAt) updates.trialEndsAt = addDays(start, DEFAULT_TRIAL_DAYS);
    if (!tenant.subscriptionStatus) updates.subscriptionStatus = 'none';
    if (tenant.payment && typeof tenant.hasCardOnFile === 'undefined') {
      updates.hasCardOnFile = hasPaymentOnFile(tenant.payment);
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await tenantsCol().updateOne({ _id: new ObjectId(tenantId) }, { $set: updates });
      Object.assign(tenant, updates);
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
      const normalized = normalizePlanId(data?.planId, data?.interval);
      if (!normalized) return res.fail(400, 'Invalid planId. Use one of p1_m, p1_y, p2_m, p2_y.');
      update.planInfo = { planId: normalized };
      update.onboardingCompleted = true;

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

export async function subscribeTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const { planId, interval, payment } = req.body as {
      planId?: string;
      interval?: string;
      payment?: {
        provider?: PaymentProvider;
        customerId?: string;
        paymentMethodId?: string;
        brand?: PaymentBrand;
        last4?: string;
        expMonth?: number;
        expYear?: number;
        country?: string;
        funding?: PaymentFunding;
      };
    };

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

    if (payment) {
      const paymentMeta: TenantDoc['payment'] = {
        provider: payment.provider ?? 'mock',
        customerId: payment.customerId,
        defaultPaymentMethodId: payment.paymentMethodId,
        brand: payment.brand ?? 'unknown',
        last4: payment.last4,
        expMonth: payment.expMonth,
        expYear: payment.expYear,
        country: payment.country,
        funding: payment.funding ?? 'unknown',
        updatedAt: now,
        createdAt: now,
      };
      $set.payment = paymentMeta;
      $set.hasCardOnFile = hasPaymentOnFile(paymentMeta);
    }

    const upd = await tenantsCol().updateOne({ _id: new ObjectId(tenantId) }, { $set });
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

export async function cancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const { mode } = (req.body ?? {}) as { mode?: 'immediate' | 'period_end' };
    const now = new Date();
    const effectiveAt = now;

    const $set: Partial<TenantDoc> = {
      subscriptionStatus: 'none',
      cancelRequestedAt: now,
      cancelEffectiveAt: effectiveAt,
      cancelAtPeriodEnd: mode === 'period_end' ? true : false,
      updatedAt: now,
    };

    // Clear stored card when cancel is immediate (delete card info)
    const $unset: Record<string, any> = {};
    if (mode !== 'period_end') {
      $set.hasCardOnFile = false;
      $unset.payment = '';
    }

    const update = Object.keys($unset).length ? { $set, $unset } : { $set };
    const upd = await tenantsCol().updateOne({ _id: new ObjectId(tenantId) }, update);
    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: mode === 'period_end' ? 'TENANT_SUBSCRIPTION_CANCEL' : 'TENANT_PAYMENT_CLEAR',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(updated) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`cancelSubscription error: ${msg}`);
    next(err);
  }
}

export async function setPaymentMethodMeta(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const {
      provider,
      customerId,
      paymentMethodId,
      brand,
      last4,
      expMonth,
      expYear,
      country,
      funding,
    } = (req.body ?? {}) as {
      provider?: PaymentProvider;
      customerId?: string;
      paymentMethodId?: string;
      brand?: PaymentBrand;
      last4?: string;
      expMonth?: number;
      expYear?: number;
      country?: string;
      funding?: PaymentFunding;
    };

    if (last4 && !/^\d{4}$/.test(last4)) return res.fail(400, 'Invalid last4');
    if (expMonth && (expMonth < 1 || expMonth > 12)) return res.fail(400, 'Invalid expMonth');
    if (expYear && expYear < 2000) return res.fail(400, 'Invalid expYear');

    const now = new Date();
    const paymentMeta: TenantDoc['payment'] = {
      provider: provider ?? 'mock',
      customerId,
      defaultPaymentMethodId: paymentMethodId,
      brand: brand ?? 'unknown',
      last4,
      expMonth,
      expYear,
      country,
      funding: funding ?? 'unknown',
      updatedAt: now,
    };

    const $set: Partial<TenantDoc> = {
      payment: paymentMeta,
      hasCardOnFile: hasPaymentOnFile(paymentMeta),
      updatedAt: now,
    };

    const upd = await tenantsCol().updateOne({ _id: new ObjectId(tenantId) }, { $set });
    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: 'TENANT_PAYMENT_SET',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(updated) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`setPaymentMethodMeta error: ${msg}`);
    next(err);
  }
}

export async function clearPaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const now = new Date();
    const upd = await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $unset: { payment: '' }, $set: { hasCardOnFile: false, updatedAt: now } }
    );
    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: 'TENANT_PAYMENT_CLEAR',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toTenantDTO(updated) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`clearPaymentMethod error: ${msg}`);
    next(err);
  }
}

/* ----------------------------- Billing profile API ----------------------------- */

export async function getBillingProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.fail(400, 'No tenant found');

    const tenant = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!tenant) return res.fail(404, 'Tenant not found');

    return res.ok({ item: toBillingProfileDTO(tenant.billingProfile) ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`getBillingProfile error: ${msg}`);
    next(err);
  }
}

export async function saveBillingProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) return res.fail(400, 'No tenant found');
    if (!userId) return res.fail(401, 'Unauthorized');

    const body = (req.body ?? {}) as v1.BillingProfileDTO;

    // Basic validation
    const companyName = String(body.companyName || '').trim();
    const billingEmail = String(body.billingEmail || '').trim();
    const address = body.address || ({} as any);
    if (!companyName) return res.fail(400, 'companyName is required');
    if (!billingEmail || !/^\S+@\S+\.\S+$/.test(billingEmail)) return res.fail(400, 'Valid billingEmail is required');
    if (!address.line1 || !address.city || !address.state || !address.postalCode || !address.country) {
      return res.fail(400, 'Complete address is required');
    }

    const now = new Date();
    const profile: TenantDoc['billingProfile'] = {
      companyName,
      billingEmail,
      extraEmails: Array.isArray(body.extraEmails) ? body.extraEmails.slice(0, 5) : [],
      address: {
        line1: String(address.line1 || '').trim(),
        line2: address.line2 ? String(address.line2).trim() : undefined,
        city: String(address.city || '').trim(),
        state: String(address.state || '').trim(),
        postalCode: String(address.postalCode || '').trim(),
        country: String(address.country || '').trim().toUpperCase(),
      },
      taxId: body.taxId ? String(body.taxId).trim() : undefined,
      taxExempt: (body.taxExempt as any) ?? 'none',
      dunningEnabled: typeof body.dunningEnabled === 'boolean' ? body.dunningEnabled : true,
      dunningDays: Array.isArray(body.dunningDays) ? body.dunningDays.slice(0, 6) : [3, 7, 14],
      updatedAt: now,
    };

    const upd = await tenantsCol().updateOne(
      { _id: new ObjectId(tenantId) },
      { $set: { billingProfile: profile, updatedAt: now } }
    );
    if (upd.matchedCount === 0) return res.fail(404, 'Tenant not found');

    const updated = await tenantsCol().findOne({ _id: new ObjectId(tenantId) });
    if (!updated) return res.fail(404, 'Tenant not found');

    await auditLog({
      userId,
      action: 'TENANT_BILLING_PROFILE_SET',
      after: toTenantDTO(updated),
      ip: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    return res.ok({ item: toBillingProfileDTO(updated.billingProfile) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`saveBillingProfile error: ${msg}`);
    next(err);
  }
}