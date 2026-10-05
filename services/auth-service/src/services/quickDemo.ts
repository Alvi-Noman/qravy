/**
 * Quick demo (/quick-demo, no account): photos of a restaurant's menu → a temporary restaurant with a live dine-in
 * storefront, shown to the owner on the spot. Uses the normal AI import and commit, so the storefront is exactly
 * what a real restaurant gets. Everything belonging to the demo is deleted after DEMO_TTL_HOURS.
 *
 *   1. createDemo: placeholder restaurant + import job; the AI starts reading right away
 *   2. nameDemo: the restaurant name (typed while the AI reads) → name + subdomain
 *   3. once the menu is read AND named, the draft is committed as-is (no review step)
 */
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { client } from '../db.js';
import logger from '../utils/logger.js';
import type { TenantDoc } from '../models/Tenant.js';
import type { MenuImportDoc } from '../models/MenuImport.js';
import { HttpError } from '../utils/httpError.js';
import { tableKeysFor } from '../utils/tableKeys.js';
import { importsCol, startImport, type ImportSource } from './menuImport/pipeline.js';
import { commitDraft, markCommitted } from './menuImport/commit.js';

const DEMO_TTL_HOURS = Number(process.env.QUICK_DEMO_TTL_HOURS ?? 24);
/** Demos alive at once (each holds a menu in the database until it expires) */
const MAX_LIVE_DEMOS = Number(process.env.QUICK_DEMO_MAX_LIVE ?? 100);
/** Demo menus the AI reads at once (each is several OpenAI calls) */
const MAX_READING = Number(process.env.QUICK_DEMO_MAX_READING ?? 4);
const DEMO_TABLES = Array.from({ length: 10 }, (_, i) => String(i + 1));
export const DEMO_TABLE = '1';

const PLACEHOLDER_NAME = 'Demo restaurant';

/** Collections whose documents carry the restaurant's tenantId */
const TENANT_COLLECTIONS = [
  'categories',
  'menuItems',
  'categoryVisibility',
  'itemAvailability',
  'locations',
  'memberships',
  'devices',
  'menuImports',
  'orders',
];

function db() {
  return client.db('authDB');
}
function tenantsCol() {
  return db().collection<TenantDoc>('tenants');
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function randomId(length: number): string {
  const bytes = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** "Café Dhaka & Grill" → "cafe-dhaka-grill" (Latin letters/digits only; may be empty for e.g. Bangla names) */
function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 22)
    .replace(/-+$/g, '');
}

export type DemoStatus = 'reading' | 'needs-name' | 'building' | 'ready' | 'failed';

export type DemoDTO = {
  key: string;
  status: DemoStatus;
  name: string | null;
  subdomain: string | null;
  progress: { done: number; total: number };
  sourceType: 'pdf' | 'photos';
  error: string | null;
  /** The dine-in table the storefront link opens, with its QR key */
  table: string;
  tableKey: string | null;
  itemCount: number;
  categoryCount: number;
  expiresAt: string;
};

function toDTO(tenant: TenantDoc, job: MenuImportDoc | null): DemoDTO {
  const demo = tenant.demo!;
  let status: DemoStatus;
  if (!job || job.status === 'failed') status = 'failed';
  else if (job.status === 'processing') status = 'reading';
  else if (job.status === 'committed') status = 'ready';
  else if (job.status === 'committing') status = 'building';
  else status = demo.named ? 'building' : 'needs-name'; // 'ready' to commit

  const ready = status === 'ready';
  return {
    key: demo.key,
    status,
    name: demo.named ? tenant.name : null,
    subdomain: ready ? tenant.subdomain : null,
    progress: job?.progress ?? { done: 0, total: 0 },
    sourceType: job?.sourceType ?? 'photos',
    error: status === 'failed' ? job?.error || 'We could not read this menu. Please try again with clearer photos.' : null,
    table: DEMO_TABLE,
    tableKey: ready ? (tenant.tableKeys?.[DEMO_TABLE] ?? null) : null,
    itemCount: job?.result ? job.result.itemsCreated + job.result.itemsUpdated : 0,
    categoryCount: job?.result ? job.result.categoriesCreated + job.result.categoriesMerged : 0,
    expiresAt: demo.expiresAt.toISOString(),
  };
}

async function findDemo(key: string): Promise<{ tenant: TenantDoc; job: MenuImportDoc | null } | null> {
  if (!/^[a-z0-9]{16,40}$/.test(key)) return null;
  const tenant = await tenantsCol().findOne({ 'demo.key': key, 'demo.expiresAt': { $gt: new Date() } });
  if (!tenant?.demo) return null;
  const job = await importsCol().findOne({ _id: tenant.demo.importId, tenantId: tenant._id });
  return { tenant, job };
}

/** Starts a demo: a placeholder restaurant (tables 1–10 with QR keys) and the AI reading the menu. */
export async function createDemo(source: ImportSource, pageCount: number, fileName: string): Promise<DemoDTO> {
  const now = new Date();
  const live = await tenantsCol().countDocuments({ 'demo.expiresAt': { $gt: now } });
  if (live >= MAX_LIVE_DEMOS) {
    throw new HttpError(429, 'Too many demos are running right now. Please try again later.');
  }
  const reading = await importsCol().countDocuments({ demo: true, status: 'processing' });
  if (reading >= MAX_READING) {
    throw new HttpError(429, 'Other demo menus are still being read. Please try again in a minute.');
  }

  const expiresAt = new Date(now.getTime() + DEMO_TTL_HOURS * 3_600_000);
  const tenantId = new ObjectId();
  const importId = new ObjectId();
  // Placeholder owner (no user account) — also the "user" on the menu's audit entries
  const ownerId = new ObjectId();
  const key = randomId(24);

  const tenant: TenantDoc = {
    _id: tenantId,
    name: PLACEHOLDER_NAME,
    subdomain: `demo-${randomId(10)}`,
    ownerId,
    onboardingCompleted: true,
    subscriptionStatus: 'none',
    restaurantInfo: {
      restaurantType: '',
      country: '',
      address: '',
      locationMode: 'single',
      dineInEnabled: true,
      onlineSalesEnabled: true,
    },
    tables: DEMO_TABLES,
    tableKeys: tableKeysFor(DEMO_TABLES),
    demo: { key, importId, named: false, expiresAt },
    createdAt: now,
    updatedAt: now,
  };
  await tenantsCol().insertOne(tenant);

  const job: MenuImportDoc = {
    _id: importId,
    tenantId,
    createdBy: ownerId,
    demo: true,
    locationId: null,
    fileName,
    sourceType: source.kind,
    pageCount,
    status: 'processing',
    progress: { done: 0, total: pageCount },
    warnings: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  await importsCol().insertOne(job);
  startImport(importId, source);
  logger.info(`[quickDemo] started demo ${tenantId} (${pageCount} ${source.kind === 'pdf' ? 'pages' : 'photos'})`);

  return toDTO(tenant, job);
}

/** Current state; builds the storefront when the menu is read and named. */
export async function getDemo(key: string): Promise<DemoDTO | null> {
  const found = await findDemo(key);
  if (!found) return null;
  const job = await buildIfReady(found.tenant, found.job);
  return toDTO(found.tenant, job);
}

/** Sets the restaurant name (and a matching subdomain), then builds the storefront if the menu is read. */
export async function nameDemo(key: string, rawName: string): Promise<DemoDTO | null> {
  const found = await findDemo(key);
  if (!found) return null;
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Please enter the restaurant name.');

  const base = slugify(name) || 'demo';
  let tenant: TenantDoc | null = null;
  for (let attempt = 0; attempt < 5 && !tenant; attempt++) {
    try {
      tenant = await tenantsCol().findOneAndUpdate(
        { _id: found.tenant._id },
        {
          $set: {
            name,
            subdomain: `${base}-${randomId(4)}`,
            'demo.named': true,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
      if (!tenant) return null;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // subdomain taken → new suffix
    }
  }
  if (!tenant) throw new HttpError(409, 'Could not save the name. Please try again.');

  const job = await buildIfReady(tenant, found.job);
  return toDTO(tenant, job);
}

/**
 * Menu read + restaurant named → commit the AI draft into the menu (in the background; the page polls).
 * The ready → committing claim is atomic, so parallel polls can't build twice.
 */
async function buildIfReady(tenant: TenantDoc, job: MenuImportDoc | null): Promise<MenuImportDoc | null> {
  if (!job || job.status !== 'ready' || !tenant.demo?.named) return job;
  const claimed = await importsCol().findOneAndUpdate(
    { _id: job._id, status: 'ready' },
    { $set: { status: 'committing', updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!claimed) return importsCol().findOne({ _id: job._id });

  const ctx = {
    userId: String(tenant.ownerId),
    tenantId: String(tenant._id),
    ip: 'quick-demo',
    userAgent: 'quick-demo',
  };
  void (async () => {
    try {
      const result = await commitDraft(ctx, claimed);
      await markCommitted(claimed._id!, result);
      logger.info(`[quickDemo] demo ${tenant._id} ready: ${result.itemsCreated} items`);
    } catch (err) {
      logger.error(`[quickDemo] demo ${tenant._id} build failed: ${(err as Error).message}`);
      await importsCol()
        .updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', error: 'Building the storefront failed. Please try again.', updatedAt: new Date() } }
        )
        .catch(() => {});
    }
  })();
  return claimed;
}

/**
 * Is this restaurant ONLY a quick demo — safe to delete? Every check must pass, or nothing is deleted:
 *   - the whole demo marking that only /quick-demo writes: its secret key, its menu-reading job, its expiry (past);
 *   - no real people: the owner is a placeholder id with NO user account (every real restaurant is owned by a real
 *     user), and no member is a real user (a demo that someone made real has staff).
 * (Exported for the tests.)
 */
export async function isDisposableDemo(t: Pick<TenantDoc, '_id' | 'ownerId' | 'demo'>, now = new Date()): Promise<boolean> {
  const demo = t.demo;
  if (!t._id || !t.ownerId || !demo) return false;
  if (typeof demo.key !== 'string' || !demo.key || !demo.importId) return false;
  if (!(demo.expiresAt instanceof Date) || demo.expiresAt > now) return false;
  const users = db().collection('users');
  if (await users.findOne({ _id: t.ownerId }, { projection: { _id: 1 } })) return false;
  const memberIds = (
    await db().collection('memberships').find({ tenantId: t._id }, { projection: { userId: 1 } }).toArray()
  )
    .map((m) => m.userId)
    .filter(Boolean);
  if (memberIds.length && (await users.findOne({ _id: { $in: memberIds } }, { projection: { _id: 1 } }))) return false;
  return true;
}

/** Deletes expired demo restaurants and everything that belongs to them — never a real restaurant (isDisposableDemo). */
export async function deleteExpiredDemos(): Promise<number> {
  const now = new Date();
  const expired = await tenantsCol()
    .find(
      { 'demo.expiresAt': { $lte: now }, 'demo.key': { $type: 'string' }, 'demo.importId': { $exists: true } },
      { projection: { _id: 1, ownerId: 1, demo: 1, name: 1 } }
    )
    .limit(200)
    .toArray();
  let deleted = 0;
  for (const t of expired) {
    if (!(await isDisposableDemo(t, now))) {
      logger.warn(`[quickDemo] NOT deleting ${t._id} ("${t.name}"): it has demo markings but doesn't look like only a demo`);
      continue;
    }
    for (const name of TENANT_COLLECTIONS) {
      await db().collection(name).deleteMany({ tenantId: t._id });
    }
    await db().collection('audits').deleteMany({ userId: t.ownerId }); // the placeholder owner (checked: not a user)
    await tenantsCol().deleteOne({ _id: t._id, 'demo.key': t.demo!.key }); // the same demo, still
    deleted++;
  }
  if (deleted) logger.info(`[quickDemo] deleted ${deleted} expired demo restaurant(s)`);
  return deleted;
}

/** Sweeps expired demos now and every 10 minutes. */
export function startQuickDemoCleanup(): void {
  const tick = () => deleteExpiredDemos().catch((e) => logger.warn(`deleteExpiredDemos: ${(e as Error).message}`));
  void tick();
  setInterval(tick, 10 * 60_000).unref();
}
