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

    const { step, data } = req.body;

    const update: Partial<TenantDoc> = {};
    if (step === 'owner') update.ownerInfo = data;
    if (step === 'restaurant') update.restaurantInfo = data;
    if (step === 'plan') update.planInfo = data;

    // If final step is "plan", mark onboarding as complete
    if (step === 'plan') update.onboardingCompleted = true;

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