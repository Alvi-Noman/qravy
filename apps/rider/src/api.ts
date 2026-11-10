// apps/rider/src/api.ts
// The rider app (/r/<link>): their deliveries, and Picked up / Delivered / couldn't deliver. No login — the
// private link the restaurant sent them is the key (it stops working if the restaurant resets it).

// same address as the app (rider.qravy.com/api → the API gateway; the dev server proxies /api)
const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) || '/api/v1';

export type RiderDelivery = {
  id: string;
  orderNumber: number;
  status: string;
  items: number;
  total: number;
  /** cash to take at the door (0 = already paid) */
  collect: number;
  cashCollected: number;
  notes: string;
  branch: string | null;
  /** hidden an hour after delivery */
  customer: { name: string; phone: string; address: string } | null;
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  problem: { reason: string; note?: string; at: string } | null;
};

export type RiderPageData = {
  restaurant: { name: string; subdomain: string };
  rider: { name: string; onDuty: boolean; vehicle: string | null };
  deliveries: RiderDelivery[];
};

export type TripAction = 'picked_up' | 'delivered' | 'problem';
export type ProblemReason = 'no-answer' | 'wrong-address' | 'refused' | 'other';

/** null = the link doesn't work (reset or removed) */
export async function getRiderPage(link: string): Promise<RiderPageData | null> {
  const res = await fetch(`${API_BASE}/public/rider/${encodeURIComponent(link)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.message || `HTTP ${res.status}`);
  return data as RiderPageData;
}

export async function riderAction(link: string, orderId: string, action: TripAction, extra: { reason?: ProblemReason; note?: string } = {}): Promise<RiderPageData> {
  const res = await fetch(`${API_BASE}/public/rider/${encodeURIComponent(link)}/orders/${encodeURIComponent(orderId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data as RiderPageData;
}

/** Something changed for this rider (a new delivery, one taken away) → onChange. Falls back to a slow poll. */
export function followRider(link: string, onChange: () => void): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let poll: number | null = null;
  const startPolling = () => {
    if (poll !== null || closed) return;
    poll = window.setInterval(() => !closed && onChange(), 20_000);
  };
  if (typeof EventSource !== 'undefined') {
    es = new EventSource(`${API_BASE}/public/rider/${encodeURIComponent(link)}/stream`);
    es.addEventListener('order.updated', () => !closed && onChange());
    es.onerror = () => startPolling();
  } else startPolling();
  return () => {
    closed = true;
    es?.close();
    if (poll !== null) window.clearInterval(poll);
  };
}
