/**
 * Add-on / choice groups on menu items ("Extras", "Choose your side").
 * Shared by create/update, the PDF import and order pricing.
 */
import { randomUUID } from 'node:crypto';
import type { ModifierGroup, ModifierOption } from '../models/MenuItem.js';

export const MAX_MODIFIER_GROUPS = 20;
export const MAX_MODIFIER_OPTIONS = 50;

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function toPrice(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/**
 * Cleans untrusted groups: trims names, drops empty/duplicate options,
 * keeps existing ids (stable for carts/orders) and assigns new ones,
 * clamps 0 ≤ min ≤ max ≤ options.length.
 */
export function normalizeModifierGroups(list: unknown): ModifierGroup[] {
  const out: ModifierGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const raw of Array.isArray(list) ? list : []) {
    const g = raw as Record<string, unknown>;
    const name = typeof g?.name === 'string' ? g.name.trim().slice(0, 60) : '';
    if (!name) continue;

    const options: ModifierOption[] = [];
    const seenNames = new Set<string>();
    const usedOptionIds = new Set<string>();
    for (const rawOpt of Array.isArray(g.options) ? g.options : []) {
      const o = rawOpt as Record<string, unknown>;
      const oname = typeof o?.name === 'string' ? o.name.trim().slice(0, 60) : '';
      if (!oname || seenNames.has(oname.toLowerCase())) continue;
      seenNames.add(oname.toLowerCase());
      let id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 40) : shortId();
      if (usedOptionIds.has(id)) id = shortId();
      usedOptionIds.add(id);
      options.push({ id, name: oname, price: toPrice(o.price) });
      if (options.length >= MAX_MODIFIER_OPTIONS) break;
    }
    if (!options.length) continue;

    let max = toInt(g.max, options.length);
    max = Math.min(Math.max(max, 1), options.length);
    let min = toInt(g.min, 0);
    min = Math.min(min, max);

    let id = typeof g.id === 'string' && g.id.trim() ? g.id.trim().slice(0, 40) : shortId();
    if (usedGroupIds.has(id)) id = shortId();
    usedGroupIds.add(id);

    out.push({ id, name, min, max, options });
    if (out.length >= MAX_MODIFIER_GROUPS) break;
  }
  return out;
}

export type ModifierSelection = { groupId: string; optionIds: string[] };

export type ResolvedModifier = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: number;
};

/**
 * Validates a customer's selections against an item's groups and returns the
 * chosen options with server-side prices. Throws Error(message) on invalid input.
 */
export function resolveModifierSelections(
  groups: ModifierGroup[] | undefined,
  selections: ModifierSelection[] | undefined
): ResolvedModifier[] {
  const byGroup = new Map<string, string[]>();
  for (const s of selections ?? []) {
    if (!s || typeof s.groupId !== 'string') continue;
    const ids = Array.isArray(s.optionIds) ? s.optionIds.filter((x) => typeof x === 'string') : [];
    byGroup.set(s.groupId, [...(byGroup.get(s.groupId) ?? []), ...ids]);
  }

  const out: ResolvedModifier[] = [];
  for (const g of groups ?? []) {
    const chosen = Array.from(new Set(byGroup.get(g.id) ?? []));
    byGroup.delete(g.id);
    if (chosen.length < g.min) {
      throw new Error(
        g.min === 1 ? `Please choose an option for "${g.name}"` : `Please choose at least ${g.min} for "${g.name}"`
      );
    }
    if (chosen.length > g.max) {
      throw new Error(g.max === 1 ? `Choose only one option for "${g.name}"` : `Choose at most ${g.max} for "${g.name}"`);
    }
    for (const optionId of chosen) {
      const opt = g.options.find((o) => o.id === optionId);
      if (!opt) throw new Error(`An option for "${g.name}" is no longer available`);
      out.push({ groupId: g.id, groupName: g.name, optionId: opt.id, name: opt.name, price: opt.price });
    }
  }
  if ([...byGroup.values()].some((ids) => ids.length)) {
    throw new Error('Some selected add-ons are no longer available');
  }
  return out;
}
