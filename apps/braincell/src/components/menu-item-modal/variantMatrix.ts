/**
 * Pure helpers behind the Shopify-style variant editor:
 * options (Size, Spice level, ...) each hold values, and every combination of values is a variant.
 *
 * Variants are keyed by the *ids* of their values (order-insensitive), so renaming a value or
 * reordering options keeps prices and images attached to the right variant.
 */

export const MAX_VARIANTS = 250;
export const LEGACY_OPTION_NAME = 'Variation';

/** Row shape exchanged with MenuItemModal (one per offered variant). */
export type VariationRow = {
  label: string;
  price?: string;
  /** Kitchen minutes for this variant; "" = same as the item */
  prepMinutes?: string;
  imagePreview?: string | null;
  imageUrl?: string | null;
  optionValues?: string[];
};

export type VariantOption = { name: string; values: string[] };

export type ValueDraft = { id: string; label: string };
export type OptionDraft = { id: string; name: string; values: ValueDraft[]; editing: boolean };

export type VariantState = {
  price: string;
  /** "" = same as the item */
  prepMinutes?: string;
  imagePreview: string | null;
  imageUrl: string | null;
  uploading?: boolean;
  imageError?: string | null;
  priceError?: string | null;
  /** Combination exists but the restaurant doesn't offer it */
  disabled?: boolean;
};

export type Combo = { key: string; ids: string[]; labels: string[] };

export const uid = () => Math.random().toString(36).slice(2, 10);
export const normKey = (s: string) => s.trim().toLowerCase();
export const keyOf = (ids: string[]) => [...ids].sort().join('|');
export const stableUrl = (u?: string | null) => (u && !u.startsWith('blob:') ? u : null);
export const blankVariant = (): VariantState => ({ price: '', imagePreview: null, imageUrl: null });

/** Typed, de-duplicated values (first occurrence wins). */
export function liveValues(o: OptionDraft): ValueDraft[] {
  const seen = new Set<string>();
  const out: ValueDraft[] = [];
  for (const v of o.values) {
    const k = normKey(v.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Ids of values that repeat an earlier value in the same option. */
export function duplicateValueIds(o: OptionDraft): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of o.values) {
    const k = normKey(v.label);
    if (!k) continue;
    if (seen.has(k)) dups.add(v.id);
    else seen.add(k);
  }
  return dups;
}

export function activeOptions(options: OptionDraft[]): OptionDraft[] {
  return options.filter((o) => liveValues(o).length > 0);
}

/** Collapse trailing blanks to exactly one so there's always an "Add another value" input. */
export function withTrailingBlank(values: ValueDraft[]): ValueDraft[] {
  const next = [...values];
  while (next.length > 1 && !next[next.length - 1].label.trim() && !next[next.length - 2].label.trim()) {
    next.pop();
  }
  if (!next.length || next[next.length - 1].label.trim()) next.push({ id: uid(), label: '' });
  return next;
}

/** Cartesian product of the active options. Returns no combos when over MAX_VARIANTS. */
export function buildCombos(options: OptionDraft[]): { combos: Combo[]; total: number } {
  const lists = activeOptions(options).map(liveValues);
  if (!lists.length) return { combos: [], total: 0 };
  const total = lists.reduce((n, l) => n * l.length, 1);
  if (total > MAX_VARIANTS) return { combos: [], total };

  let acc: Array<{ ids: string[]; labels: string[] }> = [{ ids: [], labels: [] }];
  for (const list of lists) {
    acc = acc.flatMap((c) => list.map((v) => ({ ids: [...c.ids, v.id], labels: [...c.labels, v.label.trim()] })));
  }
  return { combos: acc.map((c) => ({ ...c, key: keyOf(c.ids) })), total };
}

/**
 * Rebuild the variant map for new options. Existing variants keep their state; new ones copy
 * price/image from the previous variant that shares the most values (so adding "Spice level"
 * to a sized item keeps each size's price).
 */
export function reconcile(
  options: OptionDraft[],
  prev: Record<string, VariantState>
): Record<string, VariantState> {
  const { combos, total } = buildCombos(options);
  if (total > MAX_VARIANTS) return prev;

  const prevEntries = Object.entries(prev).map(([k, v]) => ({ ids: new Set(k.split('|')), v }));
  const next: Record<string, VariantState> = {};
  for (const c of combos) {
    if (prev[c.key]) {
      next[c.key] = prev[c.key];
      continue;
    }
    let best: VariantState | null = null;
    let bestShared = 0;
    for (const e of prevEntries) {
      if (e.v.disabled) continue;
      let shared = 0;
      for (const id of c.ids) if (e.ids.has(id)) shared++;
      if (shared > bestShared) {
        best = e.v;
        bestShared = shared;
      }
    }
    const url = best ? stableUrl(best.imageUrl ?? best.imagePreview) : null;
    next[c.key] = best ? { price: best.price, prepMinutes: best.prepMinutes, imagePreview: url, imageUrl: url } : blankVariant();
  }
  return next;
}

/**
 * Build editor state from saved data. Items saved before options existed (flat variations
 * without optionValues) become a single option so they stay editable.
 */
export function seedState(
  rows?: VariationRow[] | null,
  options?: VariantOption[] | null
): { options: OptionDraft[]; variants: Record<string, VariantState> } {
  const typed = (rows || []).filter((r) => r.label?.trim());
  let opts = (options || []).filter((o) => o?.name != null && Array.isArray(o.values) && o.values.length);
  let valuesOf = (r: VariationRow) => r.optionValues ?? [];

  if (!opts.length) {
    if (!typed.length) return { options: [], variants: {} };
    opts = [{ name: LEGACY_OPTION_NAME, values: typed.map((r) => r.label.trim()) }];
    valuesOf = (r) => [r.label.trim()];
  }

  const drafts: OptionDraft[] = opts.map((o) => ({
    id: uid(),
    name: o.name,
    editing: false,
    values: withTrailingBlank(o.values.map((label) => ({ id: uid(), label }))),
  }));
  const idByLabel = drafts.map(
    (d) => new Map(d.values.filter((v) => v.label.trim()).map((v) => [normKey(v.label), v.id]))
  );

  const variants: Record<string, VariantState> = {};
  for (const r of typed) {
    const vals = valuesOf(r);
    if (vals.length !== drafts.length) continue;
    const ids = vals.map((l, i) => idByLabel[i].get(normKey(l)));
    if (ids.some((x) => !x)) continue;
    const preview = r.imagePreview ?? r.imageUrl ?? null;
    variants[keyOf(ids as string[])] = {
      price: r.price ?? '',
      prepMinutes: r.prepMinutes ?? '',
      imagePreview: preview,
      imageUrl: r.imageUrl ?? stableUrl(preview),
    };
  }
  // Combinations missing from the saved list were removed by the restaurant
  for (const c of buildCombos(drafts).combos) {
    if (!variants[c.key]) variants[c.key] = { ...blankVariant(), disabled: true };
  }
  return { options: drafts, variants };
}

export function isValidPrice(s?: string) {
  const t = (s ?? '').trim();
  if (!t) return false;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
}

/** Problems that must be fixed before saving; null when the options are valid. */
export function optionProblems(options: OptionDraft[]) {
  const nameCounts = new Map<string, number>();
  for (const o of options) {
    const k = normKey(o.name);
    if (k) nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  }
  return options.map((o) => {
    const k = normKey(o.name);
    return {
      id: o.id,
      nameError: !k ? 'Option name is required' : (nameCounts.get(k) ?? 0) > 1 ? 'Option name already used' : null,
      valuesError: liveValues(o).length === 0 ? 'Add at least one value' : null,
      hasDuplicateValues: duplicateValueIds(o).size > 0,
    };
  });
}
