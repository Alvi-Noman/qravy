// apps/tastebud/src/utils/voice-cart.ts

import type { AiReplyMeta, VoiceCartOp } from '../types/waiter-intents';

/**
 * Minimal shape for menu items we can resolve against.
 * Works with usePublicMenu() / listMenu() outputs.
 */
export type AnyMenuItem = {
  id?: string | number;
  name?: string;
  price?: number;
  aliases?: string[];
  imageUrl?: string;
  image?: string;
  [key: string]: any;
};

export type VoiceCartModifier = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: number;
};

export type VoiceCartFns = {
  addItem: (input: {
    id: string;
    name: string;
    price: number;
    qty?: number;
    variation?: string;
    notes?: string;
    modifiers?: VoiceCartModifier[];
  }) => void;
  updateQty: (id: string, delta: number, variation?: string) => void;
  setQty: (id: string, qty: number, variation?: string) => void;
  removeItem: (id: string, variation?: string) => void;
  /** Optional: attach a kitchen note to an existing line ("less spicy") */
  setNotes?: (id: string, notes: string, variation?: string) => void;
  clear: () => void;
  /** Exact-line operations — the waiter sends a lineKey when it changes something already in the tray */
  items?: Array<{ id: string; name: string; price: number; qty: number; variation?: string; modifiers?: VoiceCartModifier[]; notes?: string; imageUrl?: string }>;
  setLineQty?: (lineKey: string, qty: number) => void;
  removeLine?: (lineKey: string) => void;
  setLineNotes?: (lineKey: string, notes: string) => void;
  replaceLine?: (lineKey: string, next: any) => void;
  /** Lines the waiter flagged (sold out, allergy/diet clash) */
  setWarnings?: (list: any[]) => void;
};

/** Spoken choices ("beef hot sauce", "szu-chuan chicken") → the item's real add-on options. */
function resolveChoices(item: AnyMenuItem | undefined, choices: unknown): VoiceCartModifier[] {
  if (!item || !Array.isArray(choices) || !choices.length) return [];
  const groups: any[] = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];
  const out: VoiceCartModifier[] = [];
  for (const raw of choices) {
    const want = String(raw ?? '').trim().toLowerCase();
    if (!want) continue;
    for (const g of groups) {
      const opt = (Array.isArray(g?.options) ? g.options : []).find(
        (o: any) => String(o?.name ?? '').trim().toLowerCase() === want,
      );
      if (opt && !out.some((m) => m.groupId === String(g.id) && m.optionId === String(opt.id))) {
        out.push({
          groupId: String(g.id),
          groupName: String(g.name ?? ''),
          optionId: String(opt.id),
          name: String(opt.name),
          price: typeof opt.price === 'number' ? opt.price : 0,
        });
        break;
      }
    }
  }
  return out;
}

/** Same identity as CartContext.cartLineKey (kept local so this file has no React imports). */
function lineKeyOf(it: { id: string; variation?: string; modifiers?: VoiceCartModifier[] }): string {
  const mods = (it.modifiers ?? []).map((m) => `${m.groupId}:${m.optionId}`).sort().join('|');
  return `${it.id}::${it.variation ?? ''}::${mods}`;
}

/* -------------------------------------------------------------------------- */
/*                               Helper: indexing                             */
/* -------------------------------------------------------------------------- */

type MenuIndex = {
  byId: Map<string, AnyMenuItem>;
  byName: Map<string, AnyMenuItem>;
};

function buildMenuIndex(menuItems?: AnyMenuItem[] | null): MenuIndex {
  const byId = new Map<string, AnyMenuItem>();
  const byName = new Map<string, AnyMenuItem>();

  if (!Array.isArray(menuItems)) return { byId, byName };

  for (const raw of menuItems) {
    if (!raw) continue;
    const id = raw.id != null ? String(raw.id) : '';
    const name = (raw.name || '').toString().trim();
    const aliases: string[] = Array.isArray(raw.aliases)
      ? raw.aliases.map((a) => String(a).trim()).filter(Boolean)
      : [];

    if (id) byId.set(id, raw);

    const allNames = new Set<string>();
    if (name) allNames.add(name.toLowerCase());
    for (const a of aliases) {
      if (a) allNames.add(a.toLowerCase());
    }

    // Use forEach instead of for..of to avoid TS downlevelIteration complaint
    allNames.forEach((key) => {
      if (!byName.has(key)) byName.set(key, raw);
    });
  }

  return { byId, byName };
}

function resolveFromMenu(
  idx: MenuIndex,
  itemId?: string,
  name?: string
): AnyMenuItem | undefined {
  const id = itemId ? String(itemId).trim() : '';
  const nm = (name || '').toString().trim();

  if (id && idx.byId.has(id)) return idx.byId.get(id);
  if (nm) {
    const hit = idx.byName.get(nm.toLowerCase());
    if (hit) return hit;
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/*                       Helper: op normalization + guards                    */
/* -------------------------------------------------------------------------- */

type NormalizedOp = 'add' | 'set' | 'remove' | 'delta' | 'note' | 'edit' | 'restore';

function normalizeOpType(value: string | undefined): NormalizedOp | null {
  const v = (value || '').toString().toLowerCase();

  if (v === 'add') return 'add';
  if (v === 'set') return 'set';
  if (v === 'remove') return 'remove';
  if (v === 'delta' || v === 'inc' || v === 'dec') return 'delta';
  if (v === 'note') return 'note';
  if (v === 'edit') return 'edit';
  if (v === 'restore') return 'restore';

  return null;
}

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value | 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return (n as number) | 0;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/*                         Core: applyVoiceCartOps                            */
/* -------------------------------------------------------------------------- */

/**
 * Apply structured cart operations from AiReplyMeta onto the current cart.
 *
 * - Uses meta.cartOps[] (if present) for precise mutations.
 * - Uses meta.clearCart === true to clear the tray.
 * - Falls through gracefully if anything is missing / malformed.
 *
 * IMPORTANT:
 *  - This does NOT handle meta.items[] "order" fallback.
 *    Keep your existing order-intent → addItem logic as a backup.
 */
export function applyVoiceCartOps(
  meta: AiReplyMeta | undefined,
  menuItems: AnyMenuItem[] | null | undefined,
  cart: VoiceCartFns
): void {
  if (!meta || !cart) return;

  const rawOps = Array.isArray((meta as any).cartOps)
    ? ((meta as any).cartOps as VoiceCartOp[])
    : [];

  const clearCartFlag = (meta as any).clearCart === true;

  // the waiter's view of the whole tray (sold out / allergy clash) — even when nothing changes this turn
  if (Array.isArray((meta as any).cartWarnings) && cart.setWarnings) {
    try {
      cart.setWarnings((meta as any).cartWarnings);
    } catch {
      /* ignore */
    }
  }

  if (!rawOps.length && !clearCartFlag) return;

  const idx = buildMenuIndex(menuItems || []);

  // If brain explicitly said clearCart: true → nuke cart first.
  if (clearCartFlag) {
    try {
      cart.clear();
    } catch {
      // ignore
    }
  }

  for (const raw of rawOps) {
    if (!raw || typeof raw !== 'object') continue;

    // Be tolerant: support either `op` or `type` on VoiceCartOp
    const kind = normalizeOpType(
      (raw as any).op ?? (raw as any).type
    );
    if (!kind) continue;

    // Resolve item against menu (by id or name/alias)
    const rawId =
      (raw as any).itemId != null ? String((raw as any).itemId) : undefined;
    const rawName = (raw as any).name ?? (raw as any).title;

    const target = resolveFromMenu(idx, rawId, rawName);

    // If we have a known catalog, ignore unknown items.
    if (!target && menuItems && menuItems.length) {
      continue;
    }

    const id = target
      ? String(target.id)
      : (rawId || (rawName ? String(rawName) : ''));

    const name =
      (target && (target.name || rawName)) ||
      (rawName ? String(rawName) : '') ||
      id;

    if (!id && !name) continue;

    const basePrice =
      target && typeof target.price === 'number' && target.price >= 0
        ? target.price
        : undefined;

    const opPrice =
      typeof (raw as any).price === 'number' && (raw as any).price >= 0
        ? (raw as any).price
        : undefined;

    // size / variant ("Half", "Large"): its own price from the menu, else the price the brain sent
    const variant = String((raw as any).variant ?? (raw as any).variation ?? '').trim() || undefined;
    const variantPrice = variant
      ? (Array.isArray(target?.variations) ? target!.variations : []).find(
          (v: any) => String(v?.name ?? '').trim().toLowerCase() === variant.toLowerCase(),
        )?.price
      : undefined;

    const price =
      (typeof variantPrice === 'number' ? variantPrice : undefined) ??
      (variant ? opPrice : undefined) ??
      basePrice ??
      opPrice ??
      0;
    const note = String((raw as any).note ?? '').trim();
    const choices: unknown = (raw as any).choices;
    const lineKey: string | undefined =
      typeof (raw as any).lineKey === 'string' && (raw as any).lineKey ? (raw as any).lineKey : undefined;
    const line = lineKey ? cart.items?.find((it) => lineKeyOf(it) === lineKey) : undefined;

    try {
      // ---- exact-line changes (the waiter knows which line: "the Full one", "L2")
      if (lineKey && kind !== 'add' && kind !== 'restore') {
        const qty = toInt((raw as any).quantity ?? (raw as any).qty, 0);
        if (kind === 'remove' && cart.removeLine) {
          cart.removeLine(lineKey);
          continue;
        }
        if (kind === 'set' && cart.setLineQty) {
          cart.setLineQty(lineKey, Math.max(0, qty));
          if (note && cart.setLineNotes) cart.setLineNotes(lineKey, note);
          continue;
        }
        if (kind === 'note' && cart.setLineNotes) {
          cart.setLineNotes(lineKey, (raw as any).removeNote ? '' : note);
          continue;
        }
        if (kind === 'edit' && cart.replaceLine && line) {
          // new size and/or add-ons → a re-priced line in the same place
          const nextVariant = variant ?? line.variation;
          const vPrice = nextVariant
            ? (Array.isArray(target?.variations) ? target!.variations : []).find(
                (v: any) => String(v?.name ?? '').trim().toLowerCase() === nextVariant.toLowerCase(),
              )?.price
            : undefined;
          const mods = Array.isArray(choices) && (choices as unknown[]).length ? resolveChoices(target, choices) : line.modifiers ?? [];
          const unit = (typeof vPrice === 'number' ? vPrice : basePrice ?? line.price) + mods.reduce((n, m) => n + (m.price || 0), 0);
          const nextNotes = (raw as any).removeNote ? undefined : note || line.notes;
          cart.replaceLine(lineKey, {
            ...line,
            ...(nextVariant ? { variation: nextVariant } : { variation: undefined }),
            modifiers: mods.length ? mods : undefined,
            notes: nextNotes,
            price: typeof (raw as any).price === 'number' ? (raw as any).price : unit,
          });
          continue;
        }
      }

      if (kind === 'restore') {
        // undo: put a line back exactly as it was
        const l = (raw as any).line || {};
        if (l.itemId) {
          cart.addItem({
            id: String(l.itemId),
            name: String(l.name || name),
            price: typeof l.price === 'number' ? l.price : price,
            qty: Math.max(1, toInt(l.quantity, 1)),
            ...(l.variation ? { variation: String(l.variation) } : {}),
            ...(Array.isArray(l.modifiers) && l.modifiers.length ? { modifiers: l.modifiers } : {}),
            ...(l.notes ? { notes: String(l.notes) } : {}),
          } as any);
        }
        continue;
      }

      switch (kind) {
        case 'add': {
          const qty = Math.max(
            1,
            toInt(
              (raw as any).quantity ?? (raw as any).qty,
              1
            )
          );
          if (!id) break;
          const modifiers = resolveChoices(target, choices);
          const surcharge = modifiers.reduce((sum, m) => sum + (m.price || 0), 0);
          cart.addItem({
            id,
            name,
            price: price + surcharge,
            qty,
            ...(variant ? { variation: variant } : {}),
            ...(note ? { notes: note } : {}),
            ...(modifiers.length ? { modifiers } : {}),
          });
          break;
        }

        case 'note': {
          // choices on an existing line can't re-key it, so they travel in the note
          const text = [...(Array.isArray(choices) ? choices.map(String) : []), note]
            .filter(Boolean)
            .join(', ');
          if (id && text && cart.setNotes) cart.setNotes(id, text, variant);
          break;
        }

        case 'set': {
          const qty = Math.max(
            0,
            toInt(
              (raw as any).quantity ?? (raw as any).qty,
              0
            )
          );
          if (!id) break;
          if (qty <= 0) {
            cart.removeItem(id, variant);
          } else {
            cart.setQty(id, qty, variant);
            if (note && cart.setNotes) cart.setNotes(id, note, variant);
          }
          break;
        }

        case 'delta': {
          const delta = toInt((raw as any).delta, 0);
          if (!delta || !id) break;
          cart.updateQty(id, delta, variant);
          break;
        }

        case 'remove': {
          if (!id) break;
          cart.removeItem(id, variant);
          break;
        }
      }
    } catch {
      // Never let cart ops crash the UI; ignore per-op errors.
    }
  }
}
