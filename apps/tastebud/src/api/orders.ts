// apps/tastebud/src/api/orders.ts
// Guest ordering: place a dine-in (table) or online (pickup / delivery) order and follow its status live.
import type { CartItem } from '../context/CartContext';

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  ((typeof window !== 'undefined' && (window as any).__STORE__?.apiBase) as string | undefined) ||
  '/api/v1';

export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export type OrderEta = {
  /** Not accepted yet: the clock hasn't started — show estimateMinutes, don't count down to readyAt */
  startsOnAccept?: boolean;
  /** How long it takes once accepted (queue + prep + staff delay) */
  estimateMinutes?: number;
  prepMinutes: number;
  queueMinutes: number;
  /** What the guest was told when ordering */
  promisedReadyAt: string;
  /** Current estimate — moves when cooking starts or the kitchen adjusts it */
  readyAt: string;
  minutesLeft: number;
  /** Still in the kitchen past the estimate */
  late: boolean;
  adjustedMinutes: number;
  /** Server clock when this was sent (corrects the phone's clock) */
  serverNow: string;
};

/** "How long if I order now?" */
export type WaitEstimate = {
  prepMinutes: number;
  queueMinutes: number;
  totalMinutes: number;
  readyAt: string;
  estimated: boolean;
  busy: 'quiet' | 'normal' | 'busy';
  ordersInKitchen: number;
  defaultPrepMinutes: number;
  serverNow: string;
};

export type PublicOrder = {
  token: string;
  orderNumber: number;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string }[];
  channel?: 'dine-in' | 'online';
  /** Dine-in only */
  table: string | null;
  /** Online only */
  fulfillment?: 'pickup' | 'delivery';
  customer?: { name: string; phone: string; address?: string };
  items: {
    itemId: string;
    name: string;
    qty: number;
    variation?: string;
    modifiers: { groupName?: string; name: string; price: number }[];
    unitPrice: number;
    lineTotal: number;
    notes?: string;
    /** Kitchen minutes for one portion */
    prepMinutes?: number;
  }[];
  subtotal: number;
  total: number;
  currency: string;
  payment: { method: 'counter' | 'cod'; status: 'unpaid' | 'paid' };
  notes?: string;
  /** Wait-time estimate — the countdown (older orders have none) */
  eta?: OrderEta;
  createdAt: string;
  updatedAt: string;
};

export class OrderApiError extends Error {
  status: number;
  needs?: string;
  constructor(message: string, status: number, needs?: string) {
    super(message);
    this.status = status;
    this.needs = needs;
  }
}

/** Cart lines → the API's line shape (the server re-prices everything). */
export function toOrderLines(items: CartItem[]) {
  return items.map((l) => ({
    itemId: l.id,
    qty: l.qty,
    ...(l.variation ? { variation: l.variation } : {}),
    ...(l.modifiers?.length
      ? { modifiers: l.modifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })) }
      : {}),
    ...(l.notes ? { notes: l.notes.slice(0, 200) } : {}),
  }));
}

/** Same cart → same key, so a double tap never creates two orders. */
export function cartIdempotencyKey(sessionId: string, items: CartItem[]): string {
  const s = JSON.stringify(toOrderLines(items));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `web:${sessionId}:${(h >>> 0).toString(36)}:${items.length}`.slice(0, 100);
}

export async function placeOrder(
  body: {
    subdomain: string;
    branch?: string | null;
    items: CartItem[];
    notes?: string;
    sessionId?: string;
    idempotencyKey?: string;
  } & (
    | { channel?: 'dine-in'; table: string }
    | { channel: 'online'; fulfillment: 'pickup' | 'delivery'; customer: { name: string; phone: string; address?: string } }
  ),
): Promise<{ order: PublicOrder; created: boolean }> {
  const where =
    body.channel === 'online'
      ? {
          channel: 'online',
          fulfillment: body.fulfillment,
          customer: {
            name: body.customer.name.trim(),
            phone: body.customer.phone.trim(),
            ...(body.fulfillment === 'delivery' ? { address: (body.customer.address ?? '').trim() } : {}),
          },
        }
      : { channel: 'dine-in', table: body.table };
  const res = await fetch(`${API_BASE}/public/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      subdomain: body.subdomain,
      ...(body.branch ? { branch: body.branch } : {}),
      ...where,
      items: toOrderLines(body.items),
      ...(body.notes?.trim() ? { notes: body.notes.trim().slice(0, 300) } : {}),
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      source: 'menu',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.order) {
    const firstFieldError = (() => {
      const e = data?.error;
      if (!e || typeof e !== 'object') return '';
      for (const v of Object.values(e as Record<string, any>)) {
        if (v && Array.isArray(v._errors) && v._errors[0]) return String(v._errors[0]);
      }
      return '';
    })();
    const msg = firstFieldError || data?.message || `Couldn't place the order (HTTP ${res.status})`;
    throw new OrderApiError(msg, res.status, data?.error?.needs);
  }
  return { order: data.order as PublicOrder, created: !!data.created };
}

export async function estimateWait(body: {
  subdomain: string;
  branch?: string | null;
  items: Array<{ itemId: string; qty: number; variation?: string | null }>;
}): Promise<WaitEstimate> {
  const res = await fetch(`${API_BASE}/public/wait-time`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ subdomain: body.subdomain, ...(body.branch ? { branch: body.branch } : {}), items: body.items }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.estimate) throw new Error(data?.message || `HTTP ${res.status}`);
  return data.estimate as WaitEstimate;
}

export async function getOrder(token: string): Promise<PublicOrder | null> {
  const res = await fetch(`${API_BASE}/public/orders/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.order as PublicOrder) ?? null;
}

/**
 * Live status (Server-Sent Events) with a polling fallback when the stream can't stay open.
 * Returns an unsubscribe function.
 */
export function followOrder(token: string, onOrder: (o: PublicOrder) => void): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let poll: number | null = null;

  const startPolling = () => {
    if (poll !== null || closed) return;
    poll = window.setInterval(async () => {
      const o = await getOrder(token).catch(() => null);
      if (o && !closed) onOrder(o);
    }, 10_000);
  };

  if (typeof EventSource !== 'undefined') {
    es = new EventSource(`${API_BASE}/public/orders/${encodeURIComponent(token)}/stream`);
    es.addEventListener('ready', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data);
        if (d?.order) onOrder(d.order);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener('order.updated', (ev) => {
      try {
        onOrder(JSON.parse((ev as MessageEvent).data));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      // the browser retries on its own; keep a slow poll as a safety net meanwhile
      startPolling();
    };
  } else {
    startPolling();
  }

  return () => {
    closed = true;
    es?.close();
    if (poll !== null) window.clearInterval(poll);
  };
}

/* ------------------------------------------------ remember this guest's recent orders */

const recentKey = (sub?: string | null) => `qravy:orders:${sub || 'anon'}`;

export type RecentOrder = { token: string; orderNumber: number; at: number };

export function rememberOrder(sub: string | null | undefined, o: { token: string; orderNumber: number }) {
  try {
    const list = recentOrders(sub).filter((r) => r.token !== o.token);
    list.unshift({ token: o.token, orderNumber: o.orderNumber, at: Date.now() });
    localStorage.setItem(recentKey(sub), JSON.stringify(list.slice(0, 5)));
  } catch {
    /* storage blocked */
  }
}

/** Orders placed within `maxAgeMs` (default the last 12 hours), newest first. */
export function recentOrders(sub?: string | null, maxAgeMs = 12 * 60 * 60 * 1000): RecentOrder[] {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(sub)) || '[]') as RecentOrder[];
    return list.filter((r) => r?.token && Date.now() - r.at < maxAgeMs);
  } catch {
    return [];
  }
}
