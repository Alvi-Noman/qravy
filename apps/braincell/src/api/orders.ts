/**
 * Orders API (staff)
 * - List active orders / recent history
 * - Move an order through Placed → Accepted → Preparing → Ready → Completed (or Cancel)
 * - Live stream of new/updated orders (SSE read with fetch, so the token stays in a header)
 */
import api from './auth';

export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export const OPEN_STATUSES: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready'];

export type OrderEta = {
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

export type AdminOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; by?: string }[];
  table: string;
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
  payment: { method: 'counter'; status: 'unpaid' | 'paid' };
  notes?: string;
  source: 'ai-waiter' | 'menu' | 'staff';
  locationId?: string | null;
  branch?: string | null;
  businessDay: string;
  /** Wait-time estimate (orders placed before wait times existed have none) */
  eta?: OrderEta;
  createdAt: string;
  updatedAt: string;
};

export async function listOrders(token: string, view: 'active' | 'history' = 'active'): Promise<AdminOrder[]> {
  const res = await api.get('/api/v1/orders', {
    headers: { Authorization: `Bearer ${token}` },
    params: { view },
  });
  return (res.data?.orders ?? []) as AdminOrder[];
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

export type OrderStreamEvent = { type: 'order.created' | 'order.updated'; order: AdminOrder };

/**
 * Follow the tenant's live order events. Reconnects with backoff; `onOpen` fires on every (re)connect so
 * the caller can re-sync anything missed while disconnected. Returns a stop function.
 */
export function streamOrders(
  token: string,
  handlers: { onEvent: (ev: OrderStreamEvent) => void; onOpen?: () => void; onDown?: () => void },
): () => void {
  const base = String(api.defaults.baseURL || '').replace(/\/$/, '');
  let stopped = false;
  let ctrl: AbortController | null = null;
  let retry = 0;

  const connect = async () => {
    if (stopped) return;
    ctrl = new AbortController();
    try {
      const res = await fetch(`${base}/api/v1/orders/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        credentials: 'include',
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      retry = 0;
      handlers.onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
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
          }
        }
      }
    } catch {
      /* network drop / abort — handled below */
    }
    if (stopped) return;
    handlers.onDown?.();
    retry = Math.min(retry + 1, 6);
    window.setTimeout(connect, 1000 * 2 ** (retry - 1)); // 1s, 2s, 4s … 32s
  };

  connect();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
