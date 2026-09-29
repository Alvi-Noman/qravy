/**
 * Pure normalization for the menu import pipeline:
 *   raw extractor output → DraftMenu, chunk merging, matching existing menu.
 * No DB access here — keeps it unit-testable.
 */
import { randomUUID } from 'node:crypto';
import { normalizeOptions, reconcileVariants } from '../../controllers/menuItemsController.js';
import { normalizeAvailability } from '../../utils/availability.js';
import { clampPrep } from '../orders/waitTime.js';
import type {
  DraftCategory,
  DraftItem,
  DraftMenu,
  DraftModifierGroup,
  DraftVariation,
  RawAddOnGroup,
  RawCategory,
  RawItem,
  RawMenu,
} from './types.js';

export const OTHER_CATEGORY = 'Other';

const MAX_NAME = 100;
const MAX_DESCRIPTION = 2000;
const MAX_TAG = 30;
const MAX_TAGS = 10;

/* --------------------------------- Strings --------------------------------- */

/** Bangla, Devanagari and Arabic-Indic digits → ASCII. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯०-९٠-٩۰-۹]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 0x09e6 && c <= 0x09ef) return String(c - 0x09e6);
    if (c >= 0x0966 && c <= 0x096f) return String(c - 0x0966);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    return String(c - 0x06f0);
  });
}

export function cleanText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "CHICKEN BIRYANI" → "Chicken Biryani"; leaves mixed-case / non-Latin text alone. */
export function fixShouting(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-/(&])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** Matching key: case/space/punctuation-insensitive, naive singular ("Drinks" ≈ "Drink"). */
export function nameKey(s: string): string {
  const base = toAsciiDigits(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return base
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Removes menu numbering/codes: "12. Chicken Tikka", "#5 Burger", "A3 - Beef Burger", "(7) Soup".
 * Keeps numbers that are part of a name ("7 Up", "1/2 Chicken", "3 Cheese Pizza").
 */
export function stripItemNumber(name: string): string {
  const out = name
    .replace(/^\s*(?:#|no\.?\s*)?\(?[A-Za-z]?\d{1,3}[A-Za-z]?\)?\s*[.):\-–—]\s+/i, '')
    .replace(/^\s*#\d{1,3}\s+/, '');
  return out.trim() || name.trim();
}

/* --------------------------------- Prices ---------------------------------- */

/**
 * Parses a price from a number or printed text.
 * Handles "৳ ২৫০", "250/-", "Tk. 1,200", "$12.50", "12,50".
 * Returns undefined for missing/negative/unparseable values.
 */
export function parsePrice(v: unknown): number | undefined {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined;
  }
  if (typeof v !== 'string') return undefined;
  const s = toAsciiDigits(v);
  const m = s.match(/\d+(?:[.,]\d+)*/);
  if (!m) return undefined;
  let token = m[0];

  const lastComma = token.lastIndexOf(',');
  const lastDot = token.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the later one is the decimal separator.
    token =
      lastDot > lastComma
        ? token.replace(/,/g, '')
        : token.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    // Only commas: thousands separators if groups of 3 (incl. Indian 1,20,000), else decimal.
    token = /^\d{1,3}(,\d{2,3})+$/.test(token) && token.length - lastComma - 1 === 3
      ? token.replace(/,/g, '')
      : token.replace(',', '.');
  } else if ((token.match(/\./g) || []).length > 1) {
    token = token.replace(/\./g, ''); // "1.200.000"
  }

  const n = Number(token);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

/* --------------------------------- Items ----------------------------------- */

/* ------------------------------ Add-on groups ------------------------------ */

const MAX_GROUPS = 20;
const MAX_GROUP_OPTIONS = 50;

/** Cleans extractor add-on groups; clamps 0 ≤ min ≤ max ≤ options. Ids are assigned on commit. */
export function toDraftModifierGroups(raw: RawAddOnGroup[] | undefined | null): DraftModifierGroup[] {
  const out: DraftModifierGroup[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(raw) ? raw : []) {
    const name = fixShouting(cleanText(g?.name, 60));
    if (!name || seen.has(name.toLowerCase())) continue;
    const options: DraftModifierGroup['options'] = [];
    const seenOpt = new Set<string>();
    for (const o of Array.isArray(g.options) ? g.options : []) {
      const oname = fixShouting(cleanText(o?.name, 60));
      if (!oname || seenOpt.has(oname.toLowerCase())) continue;
      seenOpt.add(oname.toLowerCase());
      options.push({ name: oname, price: parsePrice(o.price) ?? 0 });
      if (options.length >= MAX_GROUP_OPTIONS) break;
    }
    if (!options.length) continue;
    const max = Math.min(Math.max(Number.isInteger(g.max) ? g.max : options.length, 1), options.length);
    const min = Math.min(Math.max(Number.isInteger(g.min) ? g.min : 0, 0), max);
    seen.add(name.toLowerCase());
    out.push({ name, min, max, options });
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

/** Item groups first, then section-wide groups the item doesn't already have. */
function mergeGroups(own: DraftModifierGroup[], section: DraftModifierGroup[]): DraftModifierGroup[] {
  const names = new Set(own.map((g) => g.name.toLowerCase()));
  return [...own, ...section.filter((g) => !names.has(g.name.toLowerCase()))].slice(0, MAX_GROUPS);
}

function cleanTags(tags: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(tags) ? tags : []) {
    const v = cleanText(t, MAX_TAG);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function rawItemToDraft(
  raw: RawItem,
  pageOffset: number,
  sectionGroups: DraftModifierGroup[] = []
): DraftItem | null {
  const name = fixShouting(stripItemNumber(cleanText(raw?.name, MAX_NAME)));
  if (!name) return null;

  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((x) => cleanText(x, 200))
    .filter(Boolean);
  let confidence: 'high' | 'low' = raw.confidence === 'low' ? 'low' : 'high';

  const price = parsePrice(raw.price) ?? parsePrice(raw.priceText);

  // Options + variants → reuse the same normalization the create endpoint uses.
  const options = normalizeOptions(
    (Array.isArray(raw.options) ? raw.options : []).map((o) => ({
      name: fixShouting(cleanText(o?.name, 60)),
      values: (Array.isArray(o?.values) ? o.values : []).map((v) => cleanText(v, 60)),
    }))
  );
  const rawVariations: DraftVariation[] = (Array.isArray(raw.variants) ? raw.variants : []).map((v) => {
    const optionValues = (Array.isArray(v?.optionValues) ? v.optionValues : []).map((x) => cleanText(x, 60));
    const dv: DraftVariation = { name: optionValues.join(' / ') || 'Default', optionValues };
    const p = parsePrice(v?.price);
    if (p !== undefined) dv.price = p;
    const vPrep = clampPrep(v?.prepMinutes);
    if (vPrep !== undefined) dv.prepMinutes = vPrep;
    return dv;
  });
  let variations = options.length ? (reconcileVariants(options, rawVariations) as DraftVariation[]) : [];
  let finalOptions = options;

  if (options.length && !variations.length) {
    issues.push('Could not match variant prices to options — options removed');
    confidence = 'low';
    finalOptions = [];
  }
  if (variations.length && !variations.some((v) => typeof v.price === 'number')) {
    issues.push('Variants have no prices');
    confidence = 'low';
  }
  // Keep only option values that are actually used by a variant.
  if (variations.length) {
    finalOptions = finalOptions
      .map((o, i) => ({
        name: o.name,
        values: o.values.filter((val) => variations.some((v) => v.optionValues?.[i] === val)),
      }))
      .filter((o) => o.values.length);
    if (finalOptions.length !== options.length) {
      finalOptions = [];
      variations = [];
    }
  }

  const hasVariantPrice = variations.some((v) => typeof v.price === 'number');
  if (price === undefined && !hasVariantPrice) {
    issues.push('No price found');
    confidence = 'low';
  }

  let compareAtPrice = parsePrice(raw.compareAtPrice);
  if (compareAtPrice !== undefined && (price === undefined || compareAtPrice <= price)) {
    compareAtPrice = undefined;
  }

  const description = cleanText(raw.description, MAX_DESCRIPTION);
  const page = Number.isInteger(raw.page) && raw.page > 0 ? raw.page + pageOffset : undefined;

  const item: DraftItem = {
    tempId: randomUUID(),
    name,
    options: finalOptions,
    variations,
    tags: cleanTags(raw.tags),
    media: [],
    modifierGroups: mergeGroups(toDraftModifierGroups(raw.addOnGroups), sectionGroups),
    confidence,
    issues: Array.from(new Set(issues)),
    action: 'create',
  };
  if (description) item.description = description;
  if (price !== undefined) item.price = price;
  if (compareAtPrice !== undefined) item.compareAtPrice = compareAtPrice;
  if (page !== undefined) item.sourcePage = page;
  const itemHours = normalizeAvailability(raw.hours);
  if (itemHours.length) item.availability = itemHours;
  const prep = clampPrep(raw.prepMinutes);
  if (prep !== undefined) {
    item.prepMinutes = prep;
    if (raw.prepSource !== 'printed') item.prepEstimated = true;
  }
  return item;
}

function rawCategoryToDraft(raw: RawCategory, pageOffset: number): DraftCategory {
  const name = fixShouting(cleanText(raw?.name, MAX_NAME)) || OTHER_CATEGORY;
  const sectionGroups = toDraftModifierGroups(raw?.addOnGroups);
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map((it) => rawItemToDraft(it, pageOffset, sectionGroups))
    .filter((x): x is DraftItem => !!x);
  const cat: DraftCategory = { tempId: randomUUID(), name, items };
  const description = cleanText(raw?.description, 500);
  if (description) cat.description = description;
  const availability = normalizeAvailability(raw?.hours);
  if (availability.length) cat.availability = availability;
  return cat;
}

/* ------------------------------ Chunk merging ------------------------------ */

/** Prefer the copy with more information when the same item appears twice. */
function itemScore(i: DraftItem): number {
  return (
    (i.price !== undefined ? 4 : 0) +
    (i.variations.length ? 4 : 0) +
    (i.description ? 2 : 0) +
    (i.modifierGroups.length ? 1 : 0) +
    (i.confidence === 'high' ? 1 : 0)
  );
}

/**
 * Converts per-chunk extractor output into one DraftMenu, in page order.
 * Categories with the same name across chunks (a section continuing on the
 * next page) are merged; duplicate items within a category are collapsed.
 */
export function mergeChunks(chunks: Array<{ menu: RawMenu; pageOffset: number }>): DraftMenu {
  const byKey = new Map<string, DraftCategory>();
  const order: DraftCategory[] = [];
  const currencyVotes = new Map<string, number>();
  const notes: string[] = [];
  const seenNotes = new Set<string>();

  for (const { menu, pageOffset } of chunks) {
    for (const n of Array.isArray(menu?.notes) ? menu.notes : []) {
      const note = cleanText(n, 300);
      const k = nameKey(note);
      if (!note || !k || seenNotes.has(k) || notes.length >= 20) continue;
      seenNotes.add(k);
      notes.push(note);
    }

    const cur = cleanText(menu?.currency, 10).toUpperCase();
    if (cur) currencyVotes.set(cur, (currencyVotes.get(cur) ?? 0) + 1);

    for (const rawCat of Array.isArray(menu?.categories) ? menu.categories : []) {
      const cat = rawCategoryToDraft(rawCat, pageOffset);
      if (!cat.items.length) continue;
      const key = nameKey(cat.name);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, cat);
        order.push(cat);
        continue;
      }
      existing.description ??= cat.description;
      if (!existing.availability?.length && cat.availability?.length) existing.availability = cat.availability;
      existing.items.push(...cat.items);
    }
  }

  for (const cat of order) {
    const seen = new Map<string, number>();
    const deduped: DraftItem[] = [];
    for (const item of cat.items) {
      const k = nameKey(item.name);
      const at = seen.get(k);
      if (at === undefined) {
        seen.set(k, deduped.length);
        deduped.push(item);
      } else if (itemScore(item) > itemScore(deduped[at])) {
        deduped[at] = item;
      }
    }
    cat.items = deduped;
  }

  const currency = [...currencyVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    ...(currency ? { currency } : {}),
    ...(notes.length ? { notes } : {}),
    categories: order,
  };
}

/* ---------------------------- Match existing menu --------------------------- */

export type ExistingCategory = { id: string; name: string };
export type ExistingItem = { id: string; name: string; categoryId?: string; category?: string };

/**
 * Links draft categories to existing ones (merge) and flags items that already
 * exist in the matched category (action → skip). Mutates and returns the draft.
 */
export function matchExisting(
  draft: DraftMenu,
  categories: ExistingCategory[],
  items: ExistingItem[]
): DraftMenu {
  const catByKey = new Map(categories.map((c) => [nameKey(c.name), c]));
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));

  // items indexed by category id (fall back to category name for legacy docs)
  const itemsByCat = new Map<string, Map<string, ExistingItem>>();
  const anyItemByKey = new Map<string, ExistingItem>();
  for (const it of items) {
    const catId =
      it.categoryId ?? (it.category ? catByKey.get(nameKey(it.category))?.id : undefined);
    const k = nameKey(it.name);
    if (!anyItemByKey.has(k)) anyItemByKey.set(k, it);
    if (!catId) continue;
    let m = itemsByCat.get(catId);
    if (!m) itemsByCat.set(catId, (m = new Map()));
    if (!m.has(k)) m.set(k, it);
  }

  for (const cat of draft.categories) {
    const match = catByKey.get(nameKey(cat.name));
    cat.matchCategoryId = match ? match.id : null;
    const existingInCat = match ? itemsByCat.get(match.id) : undefined;

    for (const item of cat.items) {
      const k = nameKey(item.name);
      const dup = existingInCat?.get(k);
      if (dup) {
        item.duplicateOfItemId = dup.id;
        item.action = 'skip';
        continue;
      }
      item.duplicateOfItemId = null;
      const elsewhere = anyItemByKey.get(k);
      if (elsewhere) {
        const where =
          (elsewhere.categoryId && catNameById.get(elsewhere.categoryId)) || elsewhere.category;
        item.issues = Array.from(
          new Set([...item.issues, `An item with this name already exists${where ? ` in "${where}"` : ''}`])
        );
      }
    }
  }
  return draft;
}
