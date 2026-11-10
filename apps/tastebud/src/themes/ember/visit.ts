// apps/tastebud/src/themes/ember/visit.ts
// This visit: the orders this phone placed at this restaurant in the last few hours (not cancelled), so every Ember
// screen can treat those dishes as the guest's — not suggested again, "In your order · ×2" on the menu, a check
// before ordering the same dish while the first one is still on its way, "Your table so far", "Same again?".
// One page keeps it current (useVisitSync — it follows the orders live); any component reads it (useVisit).
import { useEffect, useSyncExternalStore } from 'react';
import type { PublicOrder } from '../../api/orders';
import { useLiveOrders } from './store';

export const VISIT_MS = 4 * 60 * 60 * 1000;

export type Visit = {
  orders: PublicOrder[];
  /** how many of each dish this visit has ordered */
  ordered: Record<string, number>;
  /** dishes in an order that hasn't reached the table yet → when that order was placed */
  onTheWay: Record<string, number>;
};

const EMPTY: Visit = { orders: [], ordered: {}, onTheWay: {} };
let current: Visit = EMPTY;
const subs = new Set<() => void>();
const seen = new Map<string, string>(); // each order's last status (for the "ready" buzz)

const placedAt = (o: PublicOrder) => {
  const first = (o.statusHistory ?? [])[0]?.at;
  const t = first ? Date.parse(first) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

export function visitOf(orders: PublicOrder[], now = Date.now()): Visit {
  const mine = orders
    .filter((o) => o.status !== 'cancelled' && now - placedAt(o) < VISIT_MS)
    .sort((a, b) => placedAt(a) - placedAt(b));
  const ordered: Record<string, number> = {};
  const onTheWay: Record<string, number> = {};
  for (const o of mine) {
    for (const l of o.items ?? []) {
      ordered[l.itemId] = (ordered[l.itemId] ?? 0) + (l.qty || 1);
      if (o.status !== 'completed') onTheWay[l.itemId] = Math.max(onTheWay[l.itemId] ?? 0, placedAt(o));
    }
  }
  return { orders: mine, ordered, onTheWay };
}

/** Keep the visit current (call once on a page). Returns the live orders as useLiveOrders does. */
export function useVisitSync(sub: string) {
  const live = useLiveOrders(sub, VISIT_MS);
  const sig = live.all.map((o) => `${o.token}:${o.status}`).join(',');
  useEffect(() => {
    current = visitOf(live.all);
    subs.forEach((f) => f());
    // an order just became ready → a buzz, on whatever page the guest is (once per order; not for one already ready)
    for (const o of live.all) {
      // (a rider's pickup counts as a step of its own: "ready" alone isn't "on the way" when a rider brings it)
      const now = `${o.status}${o.delivery?.pickedUpAt ? ':out' : ''}`;
      const before = seen.get(o.token);
      seen.set(o.token, now);
      const out = !!o.delivery?.pickedUpAt && !before?.endsWith(':out') && o.status !== 'completed';
      const delivered = !!o.delivery && o.status === 'completed' && before !== undefined && !before.startsWith('completed');
      if ((before && before !== "ready" && now === "ready") || (before && (out || delivered))) {
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* unsupported */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return live;
}

export function useVisit(): Visit {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => EMPTY,
  );
}

export { placedAt };
