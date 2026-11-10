/**
 * Orders API (staff)
 * - List active orders / recent history
 * - Move an order through Placed → Accepted → Preparing → Ready → Completed (or Cancel)
 * - Live stream of new/updated orders (SSE read with fetch, so the token stays in a header)
 */
import api from './auth';
import type { ServiceRequest } from './serviceRequests';

export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export const OPEN_STATUSES: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready'];

export type OrderEta = {
  /** Not accepted yet: no clock running — estimateMinutes is how long it takes once accepted */
  startsOnAccept?: boolean;
  estimateMinutes?: number;
  prepMinutes: number;
  queueMinutes: number;
  /** What the guest was told when ordering */
  promisedReadyAt: string;
  /** Current estimate */
  readyAt: string;
  minutesLeft: number;
  late: boolean;
  /** Minutes staff added (+) or took off (−) */
  adjustedMinutes: number;
  serverNow: string;
};

/** "Table 12" · "Pickup" · "Delivery" — how the order reaches the guest */
export function orderWhere(o: Pick<AdminOrder, 'channel' | 'table' | 'fulfillment'>): string {
  if (o.channel === 'online') return o.fulfillment === 'delivery' ? 'Delivery' : 'Pickup';
  return `Table ${o.table ?? '?'}`;
}

export type AdminOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; by?: string }[];
  channel?: 'dine-in' | 'online';
  /** Dine-in only */
  table: string | null;
  /** Dine-in: false = the guest typed the table number instead of scanning its QR code — check before cooking */
  tableVerified?: boolean | null;
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
  source: 'ai-waiter' | 'menu' | 'staff';
  locationId?: string | null;
  branch?: string | null;
  businessDay: string;
  /** Wait-time estimate (orders placed before wait times existed have none) */
  eta?: OrderEta;
  /** Delivery orders handed to one of the restaurant's riders (api/riders.ts) */
  delivery?: OrderDelivery;
  createdAt: string;
  updatedAt: string;
};

export type OrderDelivery = {
  riderId: string;
  rider: { name: string; phone: string; photoUrl: string | null; vehicle: string | null };
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cashCollected: number;
  cashSettledAt: string | null;
  /** "Couldn't deliver" from the rider */
  problem: { reason: string; note?: string; at: string } | null;
};

export async function listOrders(token: string, view: 'active' | 'history' = 'active'): Promise<AdminOrder[]> {
  const res = await api.get('/api/v1/orders', {
    headers: { Authorization: `Bearer ${token}` },
    params: { view },
  });
  return (res.data?.orders ?? []) as AdminOrder[];
}

export type OrderHistoryQuery = {
  /** business days, YYYY-MM-DD (inclusive) */
  from?: string;
  to?: string;
  /** order number, table, guest name or phone, or a dish */
  q?: string;
  status?: OrderStatus | 'open' | '';
  channel?: 'dine-in' | 'online' | 'delivery' | 'pickup' | '';
  /** one branch (the owner's branch picker) */
  location?: string;
  skip?: number;
  limit?: number;
};

export type OrderHistoryPage = { orders: AdminOrder[]; total: number; takings: number; cancelled: number };

/** The full order history — any days, searched and filtered, newest first, with the count and takings of all matches. */
export async function searchOrders(token: string, query: OrderHistoryQuery): Promise<OrderHistoryPage> {
  const params = Object.fromEntries(Object.entries({ view: 'all', ...query }).filter(([, v]) => v !== '' && v !== undefined));
  const res = await api.get('/api/v1/orders', { headers: { Authorization: `Bearer ${token}` }, params });
  return {
    orders: (res.data?.orders ?? []) as AdminOrder[],
    total: Number(res.data?.total ?? 0),
    takings: Number(res.data?.takings ?? 0),
    cancelled: Number(res.data?.cancelled ?? 0),
  };
}

export async function updateOrderStatus(token: string, id: string, status: OrderStatus): Promise<AdminOrder> {
  const res = await api.post(
    `/api/v1/orders/${encodeURIComponent(id)}/status`,
    { status },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data?.order as AdminOrder;
}

/** The kitchen pushes the ready time back (+) or forward (−); the guest's countdown follows. */
export async function adjustOrderEta(token: string, id: string, addMinutes: number): Promise<AdminOrder> {
  const res = await api.post(
    `/api/v1/orders/${encodeURIComponent(id)}/eta`,
    { addMinutes },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data?.order as AdminOrder;
}

/** No heartbeat (the server sends one every 20 s) for this long → the live connection is dead: reconnect. */
const STREAM_SILENCE_MS = 45_000;

export type OrderStreamEvent = { type: 'order.created' | 'order.updated'; order: AdminOrder };
/** A guest's "Call waiter" (see api/serviceRequests.ts) — on the same stream */
export type ServiceStreamEvent = { type: 'service.created' | 'service.updated'; request: ServiceRequest };

/**
 * Follow the tenant's live order events (and table service requests). Reconnects with backoff; `onOpen` fires on
 * every (re)connect so the caller can re-sync anything missed while disconnected. Returns a stop function.
 * Every (re)connect uses the CURRENT token (`getToken`): the sign-in token lasts 15 minutes, and a board left open
 * for hours reconnects after a deploy or a Wi-Fi blip — an old token there was refused forever ("Reconnecting" with
 * no orders arriving). Refused (401) → `onUnauthorized` gets a fresh token, then it connects again at once.
 * A connection that goes silent (no heartbeat for 45 s) is dropped and reopened — the browser doesn't notice a
 * connection that died on the way (Wi-Fi switched, a router dropped it) and the board would show "Live" while no
 * order could arrive.
 */
export function streamOrders(
  getToken: () => string | null,
  handlers: {
    onEvent: (ev: OrderStreamEvent) => void;
    onService?: (ev: ServiceStreamEvent) => void;
    onOpen?: () => void;
    onDown?: () => void;
    onUnauthorized?: () => Promise<void>;
  },
): () => void {
  const base = String(api.defaults.baseURL || '').replace(/\/$/, '');
  let stopped = false;
  let ctrl: AbortController | null = null;
  let retry = 0;

  const connect = async () => {
    if (stopped) return;
    ctrl = new AbortController();
    let refused = false;
    try {
      const res = await fetch(`${base}/api/v1/orders/stream`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}`, Accept: 'text/event-stream' },
        credentials: 'include',
        signal: ctrl.signal,
      });
      refused = res.status === 401;
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      retry = 0;
      handlers.onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let heardAt = Date.now();
      const watchdog = window.setInterval(() => {
        if (Date.now() - heardAt > STREAM_SILENCE_MS) ctrl?.abort();
      }, 5000);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          heardAt = Date.now();
          buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            const data: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if ((event === 'order.created' || event === 'order.updated') && data.length) {
              try {
                handlers.onEvent({ type: event, order: JSON.parse(data.join('\n')) as AdminOrder });
              } catch {
                /* malformed event */
              }
            } else if ((event === 'service.created' || event === 'service.updated') && data.length) {
              try {
                handlers.onService?.({ type: event, request: JSON.parse(data.join('\n')) as ServiceRequest });
              } catch {
                /* malformed event */
              }
            }
          }
        }
      } finally {
        window.clearInterval(watchdog);
      }
    } catch {
      /* network drop / abort — handled below */
    }
    if (stopped) return;
    handlers.onDown?.();
    if (refused && handlers.onUnauthorized) {
      // the token ran out: get a new one and connect again straight away (a failed refresh signs them out)
      try {
        await handlers.onUnauthorized();
      } catch {
        /* signed out, or offline — the backoff below tries again */
      }
      if (stopped) return;
      if (retry < 2) {
        retry += 1;
        window.setTimeout(connect, 500);
        return;
      }
    }
    retry = Math.min(retry + 1, 6);
    window.setTimeout(connect, 1000 * 2 ** (retry - 1)); // 1s, 2s, 4s … 32s
  };

  connect();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
