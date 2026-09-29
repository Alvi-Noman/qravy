/**
 * Commits a reviewed draft into the real menu.
 * Reuses createCategoryCore / createMenuItemCore so imported data gets the
 * exact same scoping, overlays, audit and onboarding side effects as the UI.
 */
import { ObjectId } from 'mongodb';
import { client } from '../../db.js';
import logger from '../../utils/logger.js';
import { auditLog } from '../../utils/audit.js';
import { toMenuItemDTO } from '../../utils/mapper.js';
import type { WriteCtx } from '../../utils/httpError.js';
import type { MenuItemDoc } from '../../models/MenuItem.js';
import type { MenuImportDoc } from '../../models/MenuImport.js';
import { createCategoryCore } from '../../controllers/categoriesController.js';
import {
  createMenuItemCore,
  normalizeOptions,
  normalizeVariations,
  reconcileVariants,
} from '../../controllers/menuItemsController.js';
import { menuItemSchema } from '../../validation/schemas.js';
import { normalizeModifierGroups } from '../../utils/modifiers.js';
import { normalizeAvailability } from '../../utils/availability.js';
import { importsCol } from './pipeline.js';
import type { CommitResult, DraftItem } from './types.js';

function categoriesCol() {
  return client.db('authDB').collection('categories');
}
function menuItemsCol() {
  return client.db('authDB').collection<MenuItemDoc>('menuItems');
}

function errMessage(err: unknown): string {
  const e = err as { message?: string; code?: number };
  if (e?.code === 11000) return 'Already exists';
  return e?.message || 'Unknown error';
}

function firstZodMessage(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const i = issues[0];
  if (!i) return 'Invalid item';
  const field = i.path.map(String).join('.');
  return field ? `${field}: ${i.message}` : i.message;
}

/** Item payload for menuItemSchema / createMenuItemCore. */
function toItemPayload(item: DraftItem, categoryId: string, locationId: string | null) {
  const hasVariantPrice = item.variations.some((v) => typeof v.price === 'number');
  return {
    name: item.name,
    ...(typeof item.price === 'number' ? { price: item.price } : {}),
    ...(typeof item.price === 'number' && typeof item.compareAtPrice === 'number'
      ? { compareAtPrice: item.compareAtPrice }
      : {}),
    ...(item.description ? { description: item.description } : {}),
    categoryId,
    ...(item.media.length ? { media: item.media } : {}),
    ...(hasVariantPrice ? { variations: item.variations, options: item.options } : {}),
    ...(item.modifierGroups?.length ? { modifierGroups: item.modifierGroups } : {}),
    ...(item.availability?.length ? { availability: item.availability } : {}),
    ...(typeof item.prepMinutes === 'number'
      ? { prepMinutes: item.prepMinutes, prepSource: item.prepEstimated ? ('ai' as const) : ('menu' as const) }
      : {}),
    ...(item.tags.length ? { tags: item.tags } : {}),
    ...(locationId ? { locationId } : {}),
  };
}

/** "Update" on a duplicate: overwrite content fields only (keeps scope, visibility, media). */
async function updateExistingItem(
  ctx: WriteCtx,
  itemId: string,
  payload: ReturnType<typeof toItemPayload>
): Promise<boolean> {
  if (!ObjectId.isValid(itemId)) return false;
  const tenantOid = new ObjectId(ctx.tenantId);
  const _id = new ObjectId(itemId);
  const before = await menuItemsCol().findOne({ _id, tenantId: tenantOid });
  if (!before) return false;

  const options = normalizeOptions(payload.options);
  const variations = reconcileVariants(options, normalizeVariations(payload.variations));
  const price =
    typeof payload.price === 'number'
      ? payload.price
      : variations.find((v) => typeof v.price === 'number')?.price;

  const $set: Record<string, unknown> = {
    name: payload.name,
    updatedAt: new Date(),
    updatedBy: new ObjectId(ctx.userId),
  };
  const $unset: Record<string, ''> = {};
  if (price !== undefined) $set.price = price;
  if (payload.compareAtPrice !== undefined) $set.compareAtPrice = payload.compareAtPrice;
  else $unset.compareAtPrice = '';
  if (payload.description) $set.description = payload.description;
  if (variations.length) {
    $set.variations = variations;
    if (options.length) $set.options = options;
    else $unset.options = '';
  } else {
    $unset.variations = '';
    $unset.options = '';
  }
  if (payload.tags?.length) $set.tags = payload.tags;
  // keep a time the owner already set; only fill it in when the item has none
  if (typeof payload.prepMinutes === 'number' && (typeof before.prepMinutes !== 'number' || before.prepSource === 'guess' || before.prepSource === 'ai')) {
    $set.prepMinutes = payload.prepMinutes;
    $set.prepSource = payload.prepSource ?? 'menu';
  }
  if (payload.modifierGroups?.length) $set.modifierGroups = normalizeModifierGroups(payload.modifierGroups);

  await menuItemsCol().updateOne(
    { _id, tenantId: tenantOid },
    Object.keys($unset).length ? { $set, $unset } : { $set }
  );
  const after = await menuItemsCol().findOne({ _id, tenantId: tenantOid });
  await auditLog({
    userId: ctx.userId,
    action: 'MENU_ITEM_UPDATE',
    before: toMenuItemDTO(before),
    after: after ? toMenuItemDTO(after) : undefined,
    metadata: { source: 'menu-import' },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return true;
}

/**
 * Commits the job's draft. Caller must have atomically moved the job from
 * "ready" to "committing". Per-item failures are collected, not thrown.
 */
export async function commitDraft(ctx: WriteCtx, job: MenuImportDoc): Promise<CommitResult> {
  const result: CommitResult = {
    categoriesCreated: 0,
    categoriesMerged: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsSkipped: 0,
    errors: [],
  };
  const tenantOid = new ObjectId(ctx.tenantId);
  const locationId = job.locationId ? String(job.locationId) : null;

  for (const cat of job.draft?.categories ?? []) {
    const active = cat.items.filter((i) => i.action !== 'skip');
    result.itemsSkipped += cat.items.length - active.length;
    if (!active.length) continue;

    // 1) Resolve category: merge target → existing by name → create
    let categoryId: string | null = null;
    try {
      if (cat.matchCategoryId && ObjectId.isValid(cat.matchCategoryId)) {
        const found = await categoriesCol().findOne(
          { _id: new ObjectId(cat.matchCategoryId), tenantId: tenantOid },
          { projection: { _id: 1 } }
        );
        if (found) categoryId = String(found._id);
      }
      if (!categoryId) {
        const byName = await categoriesCol().findOne(
          { tenantId: tenantOid, name: cat.name.trim() },
          { projection: { _id: 1 } }
        );
        if (byName) categoryId = String(byName._id);
      }
      if (categoryId) {
        result.categoriesMerged++;
        await fillCategoryDetails(tenantOid, categoryId, cat.description, cat.availability);
      } else {
        // Created in PDF order → appended after existing categories in that order.
        const created = await createCategoryCore(ctx, {
          name: cat.name.trim(),
          ...(cat.description ? { description: cat.description } : {}),
          ...(cat.availability?.length ? { availability: cat.availability } : {}),
          ...(locationId ? { locationId } : {}),
        });
        categoryId = String(created._id);
        result.categoriesCreated++;
      }
    } catch (err) {
      const message = `Category "${cat.name}" could not be created: ${errMessage(err)}`;
      for (const item of active) result.errors.push({ tempId: item.tempId, name: item.name, message });
      continue;
    }

    // 2) Items
    for (const item of active) {
      const payload = toItemPayload(item, categoryId, locationId);
      const parsed = menuItemSchema.safeParse(payload);
      if (!parsed.success) {
        result.errors.push({
          tempId: item.tempId,
          name: item.name,
          message: firstZodMessage(parsed.error.issues),
        });
        continue;
      }
      try {
        if (item.action === 'update' && item.duplicateOfItemId) {
          const ok = await updateExistingItem(ctx, item.duplicateOfItemId, payload);
          if (ok) {
            result.itemsUpdated++;
            continue;
          }
          // Original was deleted meanwhile → fall through and create it.
        }
        await createMenuItemCore(ctx, parsed.data as Parameters<typeof createMenuItemCore>[1]);
        result.itemsCreated++;
      } catch (err) {
        result.errors.push({ tempId: item.tempId, name: item.name, message: errMessage(err) });
      }
    }
  }

  if (job.draft?.notes?.length && (result.itemsCreated || result.itemsUpdated || result.categoriesCreated)) {
    await mergeMenuNotes(tenantOid, job.draft.notes);
  }

  logger.info(
    `[menuImport] job ${job._id} committed: +${result.categoriesCreated} categories ` +
      `(${result.categoriesMerged} merged), +${result.itemsCreated} items, ` +
      `${result.itemsUpdated} updated, ${result.itemsSkipped} skipped, ${result.errors.length} errors`
  );
  return result;
}

/** Merging into an existing category: only fill description/hours it doesn't have yet. */
async function fillCategoryDetails(
  tenantOid: ObjectId,
  categoryId: string,
  description?: string,
  availability?: unknown[]
): Promise<void> {
  const cat = await categoriesCol().findOne(
    { _id: new ObjectId(categoryId), tenantId: tenantOid },
    { projection: { description: 1, availability: 1 } }
  );
  if (!cat) return;
  const $set: Record<string, unknown> = {};
  if (!cat.description && description?.trim()) $set.description = description.trim();
  const windows = normalizeAvailability(availability);
  if (!(cat.availability as unknown[] | undefined)?.length && windows.length) $set.availability = windows;
  if (Object.keys($set).length) {
    await categoriesCol().updateOne({ _id: cat._id }, { $set: { ...$set, updatedAt: new Date() } });
  }
}

/** Adds imported menu notes to the restaurant's notes (deduped, max 20). */
async function mergeMenuNotes(tenantOid: ObjectId, notes: string[]): Promise<void> {
  const tenants = client.db('authDB').collection('tenants');
  const tenant = await tenants.findOne({ _id: tenantOid }, { projection: { menuNotes: 1 } });
  const current: string[] = Array.isArray(tenant?.menuNotes) ? tenant!.menuNotes : [];
  const key = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = new Set(current.map(key));
  const merged = [...current];
  for (const n of notes) {
    const t = n.trim().slice(0, 300);
    if (!t || seen.has(key(t)) || merged.length >= 20) continue;
    seen.add(key(t));
    merged.push(t);
  }
  if (merged.length !== current.length) {
    await tenants.updateOne({ _id: tenantOid }, { $set: { menuNotes: merged, updatedAt: new Date() } });
  }
}

/** Marks the job committed (and drops its TTL so the record is kept). */
export async function markCommitted(jobId: ObjectId, result: CommitResult): Promise<void> {
  await importsCol().updateOne(
    { _id: jobId },
    { $set: { status: 'committed', result, updatedAt: new Date() }, $unset: { expiresAt: '' } }
  );
}
