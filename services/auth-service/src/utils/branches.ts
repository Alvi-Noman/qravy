// services/auth-service/src/utils/branches.ts
// A multi-branch restaurant's links: <restaurant>.qravy.com/<slug> (the branch's online shop) and
// <restaurant>.qravy.com/<slug>/dine-in?table=12&k=<key> (one of the branch's tables). The slug comes from the branch
// name once and never changes after — it's printed in the branch's QR codes.
import type { ObjectId } from 'mongodb';
import { client } from '../db.js';
import type { LocationDoc } from '../models/Location.js';
import { tableKeyMatches } from './tableKeys.js';

const locationsCol = () => client.db('authDB').collection<LocationDoc>('locations');

// the guest app's own path segments (apps/tastebud/src/utils/table.ts, services/storefront-host) — never a branch
const RESERVED = new Set([
  'menu', 'checkout', 'order', 'orders', 'confirmation', 'dine-in', 'online', 't', 'branch',
  'api', 'cart-api', 'azure', 'ws', 'internal', 'assets', 'health', 'waiter', 'i',
]);

/** "Gulshan 2 (Main)" → "gulshan-2-main". Empty when the name has no latin letters or digits. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** A slug for this name that no other branch of the restaurant uses. */
export async function uniqueBranchSlug(tenantId: ObjectId, name: string, excludeId?: ObjectId): Promise<string> {
  const base = slugify(name) || 'branch';
  const others = await locationsCol()
    .find(
      { tenantId, slug: { $exists: true }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) },
      { projection: { slug: 1 } },
    )
    .toArray();
  const taken = new Set(others.map((l) => l.slug));
  const start = RESERVED.has(base) ? `${base}-branch` : base;
  let slug = start;
  for (let n = 2; taken.has(slug); n++) slug = `${start}-${n}`;
  return slug;
}

/** Branches made before slugs existed get one now (oldest first, so the first "Gulshan" keeps "gulshan"). */
export async function ensureBranchSlugs(tenantId: ObjectId): Promise<void> {
  const missing = await locationsCol()
    .find({ tenantId, slug: { $exists: false } }, { projection: { _id: 1, name: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  for (const loc of missing) {
    const slug = await uniqueBranchSlug(tenantId, loc.name, loc._id);
    try {
      await locationsCol().updateOne({ _id: loc._id, slug: { $exists: false } }, { $set: { slug } });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // two requests picked it at once → the next one retries
    }
  }
}

/** The restaurant's open branches, for the guest app ("Which branch?" and each branch's tables). */
export async function publicBranches(tenantId: ObjectId) {
  await ensureBranchSlugs(tenantId);
  const locs = await locationsCol()
    .find({ tenantId, disabled: { $ne: true } }, { projection: { slug: 1, name: 1, address: 1, tables: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  return locs.map((l) => ({ slug: l.slug as string, name: l.name, address: l.address || '', tables: l.tables ?? [] }));
}

type TenantTables = { tables?: unknown; tableKeys?: unknown; [field: string]: unknown } | null | undefined;

/** The tables a dine-in order or waiter call can be for: the branch's own, plus the restaurant-wide ones (codes printed
 *  before branches had tables). No tables set up anywhere → any table number goes. */
export async function tableBook(tenant: TenantTables, locationId: ObjectId | null) {
  const loc = locationId
    ? await locationsCol().findOne({ _id: locationId }, { projection: { tables: 1, tableKeys: 1 } })
    : null;
  const norm = (t: string) => t.replace(/^#/, '').toUpperCase();
  const tables = [...(loc?.tables ?? []), ...(Array.isArray(tenant?.tables) ? (tenant.tables as string[]) : [])].map(
    (t) => norm(String(t)),
  );
  const keySets = [loc?.tableKeys, tenant?.tableKeys as Record<string, string> | undefined].filter(
    (k): k is Record<string, string> => !!k,
  );
  return {
    /** Is this one of the restaurant's (branch's) tables? */
    knows: (table: string) => !tables.length || tables.includes(norm(table)),
    /** Did the guest scan this table's QR code? (a table without a key has nothing to check) */
    verified: (table: string, key?: string | null) =>
      !keySets.some((k) => !!k[norm(table)]) || keySets.some((k) => tableKeyMatches(k, table, key)),
  };
}

/** A guest order or table call that names no branch: with one open branch it is that branch's; with two or more
 *  the guest has to choose (the storefront asks "Which branch?") — otherwise no branch's staff would ever see it. */
export async function branchForUnnamed(tenantId: ObjectId): Promise<{ locationId: ObjectId | null; mustChoose: boolean }> {
  const open = await locationsCol()
    .find({ tenantId, disabled: { $ne: true } }, { projection: { _id: 1 } })
    .limit(2)
    .toArray();
  if (open.length >= 2) return { locationId: null, mustChoose: true };
  return { locationId: (open[0]?._id as ObjectId | undefined) ?? null, mustChoose: false };
}
