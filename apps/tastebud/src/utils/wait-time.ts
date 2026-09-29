// apps/tastebud/src/utils/wait-time.ts
// Wait-time estimation on the guest side: dish labels ("~15 min"), a debounced estimate for the cart
// (the server knows the live kitchen queue), and a countdown that corrects for the phone's clock.
import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateWait, type WaitEstimate } from '../api/orders';
import type { CartItem } from '../context/CartContext';

type Timed = { prepMinutes?: number | null; variations?: Array<{ name?: string; prepMinutes?: number | null }> | null };

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The dish's own kitchen time (fastest–slowest size), or null when the restaurant hasn't set one. */
export function prepRange(item: Timed | null | undefined): { min: number; max: number } | null {
  if (!item) return null;
  const base = valid(item.prepMinutes) ? item.prepMinutes : null;
  const sizes = (item.variations ?? []).map((v) => (valid(v?.prepMinutes) ? v!.prepMinutes! : base));
  const times = (sizes.length ? sizes : [base]).filter(valid);
  if (!times.length) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
}

/** Minutes for one size (falls back to the item's own time). */
export function prepFor(item: Timed | null | undefined, variation?: string | null): number | null {
  if (!item) return null;
  const v = (item.variations ?? []).find((x) => (x?.name ?? '').trim().toLowerCase() === (variation ?? '').trim().toLowerCase());
  if (v && valid(v.prepMinutes)) return v.prepMinutes;
  return valid(item.prepMinutes) ? item.prepMinutes : null;
}

/** Waiters don't say "23 minutes": under 10 exact, then to the nearest 5 (same rule as the virtual waiter). */
export function roundForGuest(m: number): number {
  return m <= 10 ? Math.max(1, Math.round(m)) : 5 * Math.ceil(m / 5);
}

export function minutesLabel(r: { min: number; max: number } | number): string {
  if (typeof r === 'number') return `${roundForGuest(r)} min`;
  const a = roundForGuest(r.min);
  const b = roundForGuest(r.max);
  return a === b ? `${a} min` : `${a}–${b} min`;
}

/** Remaining time to `readyAt`, ticking every second; `serverNow` corrects a phone clock that's off. */
export function useCountdown(readyAt?: string | null, serverNow?: string | null) {
  const skewRef = useRef(0);
  useEffect(() => {
    if (serverNow) skewRef.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!readyAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [readyAt]);
  return useMemo(() => {
    if (!readyAt) return null;
    const ms = new Date(readyAt).getTime() - (now + skewRef.current);
    const secs = Math.round(ms / 1000);
    return { msLeft: ms, secsLeft: Math.max(0, secs), minutesLeft: Math.max(0, Math.ceil(ms / 60000)), overdue: ms < 0 };
  }, [readyAt, now]);
}

/** "How long if I order now?" for the cart — re-asked (debounced) when the cart changes, and every minute. */
export function useCartWait(opts: { subdomain?: string | null; branch?: string | null; items: CartItem[] }) {
  const { subdomain, branch, items } = opts;
  const key = useMemo(
    () => JSON.stringify(items.map((l) => [l.id, l.qty, l.variation ?? ''])),
    [items],
  );
  const [estimate, setEstimate] = useState<WaitEstimate | null>(null);
  useEffect(() => {
    if (!subdomain || !items.length) {
      setEstimate(null);
      return;
    }
    let alive = true;
    const ask = () =>
      estimateWait({
        subdomain,
        branch,
        items: items.map((l) => ({ itemId: l.id, qty: l.qty, variation: l.variation ?? null })),
      })
        .then((e) => alive && setEstimate(e))
        .catch(() => alive && setEstimate(null));
    const t = window.setTimeout(ask, 400);
    const refresh = window.setInterval(ask, 60_000);
    return () => {
      alive = false;
      window.clearTimeout(t);
      window.clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain, branch, key]);
  return estimate;
}
