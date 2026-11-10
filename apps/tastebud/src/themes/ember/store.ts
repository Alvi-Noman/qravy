// apps/tastebud/src/themes/ember/store.ts
// Where an Ember page is (restaurant, branch, dine-in or online, the table) and the guest's live orders — the same
// rules as the original pages (utils/order-mode, utils/table, api/orders); only the look differs.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { followOrder, getOrder, recentOrders, type OrderStatus, type PublicOrder } from '../../api/orders';
import { useOrderChannel } from '../../utils/order-mode';
import { useTable, withTable } from '../../utils/table';
import { storeBasePath } from '../../utils/checkout-flow';
import { useTenantInfo } from '../../utils/waiter-lang';
import { useCountdown } from '../../utils/wait-time';

export function useStoreRoute() {
  const { subdomain, branch, branchSlug } = useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();
  const store = typeof window !== 'undefined' ? (window as any).__STORE__ : undefined;
  const sub: string = subdomain ?? search.get('subdomain') ?? store?.subdomain ?? 'demo';
  const br: string | null = branch ?? branchSlug ?? search.get('branch') ?? store?.branch ?? null;
  const channel = useOrderChannel(sub);
  const [table] = useTable(sub);
  const info = useTenantInfo(sub) as any;
  const base = storeBasePath(sub, br);
  return {
    sub,
    branch: br,
    channel,
    online: channel === 'online',
    table,
    info,
    waiterName: String(info?.waiter?.name || '').trim() || 'Pixie',
    homeHref: withTable(base || '/', sub),
    menuHref: (hash = '') => withTable(`${base}/menu${hash}`, sub),
    checkoutHref: withTable(`${base}/checkout`, sub),
  };
}

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready'];

/** This guest's orders from the last few hours, followed live (newest first). */
export function useLiveOrders(sub: string, maxAgeMs = 6 * 60 * 60 * 1000) {
  const recent = useMemo(() => recentOrders(sub, maxAgeMs), [sub, maxAgeMs]);
  const [orders, setOrders] = useState<Record<string, PublicOrder>>({});
  const tokens = recent.map((r) => r.token).join(',');
  useEffect(() => {
    if (!tokens) return;
    let alive = true;
    const stops: Array<() => void> = [];
    for (const r of recent) {
      getOrder(r.token)
        .then((o) => alive && o && setOrders((m) => ({ ...m, [o.token]: o })))
        .catch(() => {});
      stops.push(followOrder(r.token, (o) => alive && setOrders((m) => ({ ...m, [o.token]: o }))));
    }
    return () => {
      alive = false;
      stops.forEach((s) => s());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);
  const list = recent.map((r) => orders[r.token]).filter(Boolean) as PublicOrder[];
  return {
    all: list,
    /** still with the restaurant (not served / collected / cancelled) */
    active: list.filter((o) => ACTIVE.includes(o.status)),
  };
}

/** Minutes left on an order (null while it waits to be accepted), and how far along the ring is. */
export function useOrderClock(o: PublicOrder | null | undefined) {
  const accepted = !!o && o.status !== 'placed' && !o.eta?.startsOnAccept;
  const cd = useCountdown(accepted ? o?.eta?.readyAt : null, o?.eta?.serverNow);
  const total = Math.max(1, o?.eta?.estimateMinutes ?? o?.eta?.prepMinutes ?? 15);
  const minutes = accepted && cd ? cd.minutesLeft : null;
  const fraction = minutes == null ? 0.22 : Math.max(0.04, Math.min(1, minutes / total));
  const readyAt = o?.eta?.readyAt ? new Date(o.eta.readyAt) : null;
  return { accepted, minutes, overdue: !!cd?.overdue, fraction, readyAt };
}

export const clockTime = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
