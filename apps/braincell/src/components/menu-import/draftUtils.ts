import type { DraftCategory, DraftItem, DraftMenu } from '../../api/menuImports';

export function hasVariantPrice(item: DraftItem): boolean {
  return item.variations.some((v) => typeof v.price === 'number');
}

/** Hard problems that would make the server reject the item. */
export function itemBlockingIssue(item: DraftItem): string | null {
  if (item.action === 'skip') return null;
  if (!item.name.trim()) return 'Name is required';
  if (typeof item.price !== 'number' && !hasVariantPrice(item)) return 'Price is required';
  if (
    typeof item.compareAtPrice === 'number' &&
    typeof item.price === 'number' &&
    item.compareAtPrice < item.price
  ) {
    return 'Compare-at price must be ≥ price';
  }
  return null;
}

/** Category-level problems that would make the import fail. */
export function draftHasInvalidHours(draft: DraftMenu): boolean {
  return draft.categories.some((c) =>
    (c.availability ?? []).some((w) => !w.days.length || w.start === w.end)
  );
}

export function itemNeedsAttention(item: DraftItem): boolean {
  if (item.action === 'skip') return false;
  return !!itemBlockingIssue(item) || item.confidence === 'low' || item.issues.length > 0;
}

export type DraftStats = {
  categories: number;
  merged: number;
  items: number;
  included: number;
  skipped: number;
  updates: number;
  attention: number;
  blocking: number;
  duplicates: number;
};

export function draftStats(draft: DraftMenu): DraftStats {
  const s: DraftStats = {
    categories: 0,
    merged: 0,
    items: 0,
    included: 0,
    skipped: 0,
    updates: 0,
    attention: 0,
    blocking: 0,
    duplicates: 0,
  };
  for (const c of draft.categories) {
    const active = c.items.some((i) => i.action !== 'skip');
    if (active) {
      s.categories++;
      if (c.matchCategoryId) s.merged++;
    }
    for (const i of c.items) {
      s.items++;
      if (i.duplicateOfItemId) s.duplicates++;
      if (i.action === 'skip') s.skipped++;
      else {
        s.included++;
        if (i.action === 'update') s.updates++;
      }
      if (itemNeedsAttention(i)) s.attention++;
      if (itemBlockingIssue(i)) s.blocking++;
    }
  }
  return s;
}

export function formatPrice(n: number | undefined, currency?: string): string {
  if (typeof n !== 'number') return '—';
  const v = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (!currency) return v;
  const sym: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€', GBP: '£', INR: '₹' };
  return sym[currency] ? `${sym[currency]}${v}` : `${v} ${currency}`;
}

/** Parses a price input; empty → undefined, invalid → NaN. */
export function parsePriceInput(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

export function newTempId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function blankItem(): DraftItem {
  return {
    tempId: newTempId(),
    name: '',
    options: [],
    variations: [],
    tags: [],
    media: [],
    modifierGroups: [],
    confidence: 'high',
    issues: [],
    action: 'create',
  };
}

/* ------------------------- MenuItemModal adapters -------------------------- */

export function toModalInitial(item: DraftItem, cat: DraftCategory) {
  return {
    name: item.name,
    price: typeof item.price === 'number' ? String(item.price) : '',
    compareAtPrice: typeof item.compareAtPrice === 'number' ? String(item.compareAtPrice) : '',
    description: item.description || '',
    category: cat.name,
    imagePreviews: item.media,
    tags: item.tags,
    variations: item.variations.map((v) => ({
      label: v.name,
      price: typeof v.price === 'number' ? String(v.price) : '',
      imagePreview: v.imageUrl || null,
      optionValues: v.optionValues,
      prepMinutes: typeof v.prepMinutes === 'number' ? String(v.prepMinutes) : '',
    })),
    options: item.options,
    prepMinutes: item.prepMinutes,
    modifierGroups: item.modifierGroups ?? [],
    availability: item.availability ?? [],
  };
}

export type ModalValues = {
  name: string;
  price?: number;
  compareAtPrice?: number;
  description?: string;
  media?: string[];
  variations?: { name: string; price?: number; imageUrl?: string; optionValues?: string[]; prepMinutes?: number }[];
  options?: { name: string; values: string[] }[];
  prepMinutes?: number | null;
  modifierGroups?: DraftItem['modifierGroups'];
  availability?: DraftItem['availability'];
  tags?: string[];
};

/** Applies values from MenuItemModal to a draft item (the owner has now reviewed it). */
export function applyModalValues(item: DraftItem, v: ModalValues): DraftItem {
  const variations = (v.variations || [])
    .filter((x) => x.name?.trim())
    .map((x) => {
      const out: DraftItem['variations'][number] = { name: x.name.trim() };
      if (typeof x.price === 'number') out.price = x.price;
      if (x.imageUrl) out.imageUrl = x.imageUrl;
      if (x.optionValues?.length) out.optionValues = x.optionValues;
      if (typeof x.prepMinutes === 'number') out.prepMinutes = x.prepMinutes;
      return out;
    });
  const next: DraftItem = {
    ...item,
    name: v.name.trim(),
    description: v.description?.trim() || undefined,
    price: typeof v.price === 'number' ? v.price : undefined,
    compareAtPrice: typeof v.compareAtPrice === 'number' ? v.compareAtPrice : undefined,
    media: v.media || [],
    variations,
    options: variations.length ? v.options || [] : [],
    tags: v.tags || [],
    modifierGroups: v.modifierGroups || [],
    availability: v.availability?.length ? v.availability : undefined,
    // untouched in the modal → keep the import's time (and its "est." flag); changed → the owner's
    ...(v.prepMinutes === undefined
      ? {}
      : { prepMinutes: typeof v.prepMinutes === 'number' ? v.prepMinutes : undefined, prepEstimated: undefined }),
    confidence: 'high',
    issues: [],
  };
  return next;
}
