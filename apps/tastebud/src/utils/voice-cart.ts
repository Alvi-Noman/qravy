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

export type VoiceCartFns = {
  addItem: (input: { id: string; name: string; price: number; qty?: number }) => void;
  updateQty: (id: string, delta: number, variation?: string) => void;
  setQty: (id: string, qty: number, variation?: string) => void;
  removeItem: (id: string, variation?: string) => void;
  clear: () => void;
};

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

type NormalizedOp = 'add' | 'set' | 'remove' | 'delta';

function normalizeOpType(value: string | undefined): NormalizedOp | null {
  const v = (value || '').toString().toLowerCase();

  if (v === 'add') return 'add';
  if (v === 'set') return 'set';
  if (v === 'remove') return 'remove';
  if (v === 'delta' || v === 'inc' || v === 'dec') return 'delta';

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

    const price = basePrice ?? opPrice ?? 0;

    try {
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
          cart.addItem({ id, name, price, qty });
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
            cart.removeItem(id);
          } else {
            cart.setQty(id, qty);
          }
          break;
        }

        case 'delta': {
          const delta = toInt((raw as any).delta, 0);
          if (!delta || !id) break;
          cart.updateQty(id, delta);
          break;
        }

        case 'remove': {
          if (!id) break;
          cart.removeItem(id);
          break;
        }
      }
    } catch {
      // Never let cart ops crash the UI; ignore per-op errors.
    }
  }
}
