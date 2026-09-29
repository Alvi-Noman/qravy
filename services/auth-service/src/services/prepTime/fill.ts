/**
 * Filling in prep times on the menu: dishes without a time (or with only a rule-of-thumb guess) get an AI
 * estimate of their own. Times the restaurant set, or that were printed on the menu, are never touched.
 */
import { ObjectId, type AnyBulkWriteOperation } from 'mongodb';
import { client } from '../../db.js';
import logger from '../../utils/logger.js';
import type { MenuItemDoc } from '../../models/MenuItem.js';
import { estimateWithAI, guessPrep, type PrepInput, type PrepSource } from './estimator.js';

const itemsCol = () => client.db('authDB').collection<MenuItemDoc>('menuItems');

/** An item's time can be (re)estimated unless a person set it: owner-set or printed on the menu. */
function estimableFilter(tenantOid: ObjectId, redoAi: boolean): Record<string, unknown> {
  const sources: PrepSource[] = redoAi ? ['guess', 'ai'] : ['guess'];
  return {
    tenantId: tenantOid,
    $or: [
      { prepMinutes: { $exists: false } },
      { prepMinutes: null },
      { prepSource: { $in: sources } },
    ],
  };
}

function toInput(d: MenuItemDoc): PrepInput {
  return {
    id: String(d._id),
    name: d.name,
    category: d.category ?? null,
    description: d.description ?? null,
    sizes: (d.variations ?? []).map((v) => v.name).filter(Boolean),
  };
}

/** Estimate and save. `ids` limits it to some dishes; `redoAi` also refreshes earlier AI estimates. */
export async function fillPrepTimes(
  tenantOid: ObjectId,
  opts: { ids?: ObjectId[]; redoAi?: boolean } = {}
): Promise<{ updated: number; source: 'ai' | 'guess' }> {
  const q = estimableFilter(tenantOid, !!opts.redoAi);
  if (opts.ids?.length) q._id = { $in: opts.ids };
  const docs = await itemsCol()
    .find(q, { projection: { name: 1, category: 1, description: 1, variations: 1 } })
    .limit(2000)
    .toArray();
  if (!docs.length) return { updated: 0, source: 'ai' };

  const { estimates, source } = await estimateWithAI(docs.map(toInput));
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const now = new Date();
  const ops: AnyBulkWriteOperation<MenuItemDoc>[] = [];
  for (const e of estimates) {
    const d = byId.get(e.id);
    if (!d) continue;
    const $set: Record<string, unknown> = { prepMinutes: e.minutes, prepSource: source, updatedAt: now };
    // a size gets its own time only when the AI says it differs; sizes the owner timed keep theirs
    if (d.variations?.length && Object.keys(e.sizes).length) {
      $set.variations = d.variations.map((v) => {
        const m = e.sizes[String(v.name).trim().toLowerCase()];
        return typeof v.prepMinutes === 'number' || m === undefined ? v : { ...v, prepMinutes: m };
      });
    }
    // re-check the filter so a time the owner typed meanwhile is never overwritten
    ops.push({ updateOne: { filter: { _id: d._id!, ...estimableFilter(tenantOid, !!opts.redoAi) }, update: { $set } } });
  }
  if (!ops.length) return { updated: 0, source };
  const res = await itemsCol().bulkWrite(ops, { ordered: false });
  logger.info(`[prepTime] tenant=${tenantOid} estimated ${res.modifiedCount}/${docs.length} dishes (${source})`);
  return { updated: res.modifiedCount, source };
}

/** Fire-and-forget after a save: the guess is already on the item, the AI refines it in the background. */
export function refineInBackground(tenantOid: ObjectId, ids: ObjectId[], redoAi = false): void {
  if (!ids.length) return;
  fillPrepTimes(tenantOid, { ids, redoAi }).catch((e) =>
    logger.warn(`[prepTime] background estimate failed: ${(e as Error).message}`)
  );
}

/** How many dishes have a time, and from where (Settings → Kitchen). */
export async function prepStatus(tenantOid: ObjectId) {
  const rows = await itemsCol()
    .aggregate<{ _id: string | null; n: number }>([
      { $match: { tenantId: tenantOid } },
      {
        $group: {
          _id: {
            $cond: [
              { $not: [{ $isNumber: '$prepMinutes' }] },
              'missing',
              { $ifNull: ['$prepSource', 'owner'] }, // older items with a time were set by a person
            ],
          },
          n: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const c = Object.fromEntries(rows.map((r) => [String(r._id), r.n])) as Record<string, number>;
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, owner: c.owner ?? 0, menu: c.menu ?? 0, ai: c.ai ?? 0, guess: c.guess ?? 0, missing: c.missing ?? 0 };
}

/** One dish, before it's saved (the item modal's "Ask AI" button). */
export async function suggestPrep(input: Omit<PrepInput, 'id'>) {
  const { estimates, source } = await estimateWithAI([{ ...input, id: 'x' }]);
  const e = estimates[0] ?? { minutes: guessPrep(input), sizes: {} };
  return { minutes: e.minutes, sizes: e.sizes, source };
}
