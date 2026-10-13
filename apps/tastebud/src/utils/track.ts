// apps/tastebud/src/utils/track.ts
// What guests do here, for the company's Cortex panel (services/auth-service/src/routes/eventsRoutes.ts): QR scans,
// page visits, talking to the AI waiter, its suggestions, checkout, orders, waiter calls, and time on the page.
// No personal data: a random device id (the waiter's session id), a visit id (this tab; a new one after 30 quiet
// minutes), the restaurant / branch / channel / table, and what happened. Batched, best-effort, never in the way.
import { getStableSessionId } from './ws';
import { getTable, isDineInPath, splitStorePath, storeBranchFromPath, storeSubFromPath } from './table';

export type TrackType =
  | 'scan'
  | 'visit'
  | 'waiter_start'
  | 'ai_turn'
  | 'suggestions_opened'
  | 'suggestion_added'
  | 'item_added'
  | 'checkout_started'
  | 'order_placed'
  | 'call_waiter'
  | 'ping';

type Page = 'home' | 'menu' | 'checkout' | 'order' | 'other';
type Ev = { type: TrackType; at: number; page?: Page; data?: Record<string, string | number> };
type Ctx = { sub: string; branch: string | null; channel: 'dine-in' | 'online'; table: string | null; did: string; vid: string };

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  ((typeof window !== 'undefined' && (window as any).__STORE__?.apiBase) as string | undefined) ||
  '/api/v1';

const VISIT_KEY = 'qravy:visit';
const IDLE_MS = 30 * 60 * 1000;

/** This visit: one per tab, a new one after 30 minutes without anything happening. */
function visitId(): string {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(VISIT_KEY);
    const v = raw ? (JSON.parse(raw) as { id: string; last: number }) : null;
    const id = v && now - v.last < IDLE_MS ? v.id : `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(VISIT_KEY, JSON.stringify({ id, last: now }));
    return id;
  } catch {
    return 'nostorage';
  }
}

/** The page kind from the storefront path: "/t/x/gulshan/dine-in/menu" → "menu". */
export function pageOf(pathname: string): Page {
  const { rest } = splitStorePath(pathname);
  if (!rest || rest === '/') return 'home';
  if (rest.startsWith('/menu')) return 'menu';
  if (rest.startsWith('/checkout')) return 'checkout';
  if (rest.startsWith('/order') || rest.startsWith('/confirmation')) return 'order';
  return 'other';
}

function contextNow(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  const sub = storeSubFromPath(path);
  if (!sub) return null;
  const dineIn = isDineInPath(path);
  return {
    sub,
    branch: storeBranchFromPath(path),
    channel: dineIn ? 'dine-in' : 'online',
    table: dineIn ? getTable(sub) : null,
    did: getStableSessionId(),
    vid: visitId(),
  };
}

// the same moment reported twice (a page re-rendering, dev mode's double effects) counts once
const ONCE: ReadonlySet<TrackType> = new Set(['visit', 'scan', 'checkout_started', 'waiter_start', 'suggestions_opened']);
const lastOnce = new Map<string, number>();

let queue: Ev[] = [];
let queueCtx: Ctx | null = null;
let timer: number | null = null;

function flush(): void {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || !queueCtx) return;
  const body = JSON.stringify({ ctx: queueCtx, events: queue });
  queue = [];
  try {
    void fetch(`${API_BASE}/public/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true, // still sent when the page is closing
    }).catch(() => {});
  } catch {
    /* tracking never bothers the guest */
  }
}

/** Record something the guest did (sent in a few seconds, with whatever else happened). */
export function track(type: TrackType, extra?: { page?: Page; data?: Record<string, string | number> }): void {
  try {
    const ctx = contextNow();
    if (!ctx) return;
    if (ONCE.has(type)) {
      const key = `${ctx.vid}|${type}|${extra?.page ?? ''}`;
      const prev = lastOnce.get(key);
      if (prev && Date.now() - prev < 1500) return;
      if (lastOnce.size > 50) lastOnce.clear();
      lastOnce.set(key, Date.now());
    }
    // a new branch / channel / table / visit → what was queued goes with its own context first
    if (queueCtx && JSON.stringify(queueCtx) !== JSON.stringify(ctx)) flush();
    queueCtx = ctx;
    queue.push({ type, at: Date.now(), ...(extra ?? {}) });
    if (queue.length >= 20) flush();
    else if (!timer) timer = window.setTimeout(flush, 10_000); // a batch every 10 s at most (and on leaving the page)
  } catch {
    /* never in the way */
  }
}

/* ------------------------------------------------------------------ suggestions taken */

// dishes the AI waiter just suggested or offered: adding one of them (by voice, the tray's picks, the menu) is a
// suggestion taken
const suggested = new Map<string, number>();
const SUGGESTED_FOR_MS = 15 * 60 * 1000;

export function noteSuggested(ids: Array<string | number | null | undefined>): void {
  const now = Date.now();
  for (const id of ids) if (id != null && String(id)) suggested.set(String(id), now);
}

/** An item reached the tray (CartContext.addItem). */
export function trackItemAdded(itemId: string, qty: number): void {
  track('item_added', { data: { itemId, qty } });
  const at = suggested.get(itemId);
  if (at && Date.now() - at < SUGGESTED_FOR_MS) {
    suggested.delete(itemId);
    track('suggestion_added', { data: { itemId } });
  }
}

/* ------------------------------------------------------------------ page views, scans, time on page */

let started = false;

/** A visit counts its QR scan once — a table's pages keep its key in the link, and pages can be reloaded. */
function scannedOnce(vid: string): boolean {
  try {
    const k = `qravy:scanned:${vid}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
    return true;
  } catch {
    return false;
  }
}

/** A storefront page was shown (router location change). The visit's first page from a QR code is also a scan. */
export function trackPageView(pathname: string, search: string): void {
  const page = pageOf(pathname);
  track('visit', { page });
  const ctx = contextNow();
  const params = new URLSearchParams(search);
  // a table's QR code carries its key (?table=12&k=…); the online codes carry ?qr=1
  if (ctx && (params.has('k') || params.has('qr')) && scannedOnce(ctx.vid)) track('scan', { page });
  if (!started && typeof window !== 'undefined') {
    started = true;
    // still here, every minute while the page is in front — how long visits last
    window.setInterval(() => {
      if (document.visibilityState === 'visible') track('ping');
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }
}
