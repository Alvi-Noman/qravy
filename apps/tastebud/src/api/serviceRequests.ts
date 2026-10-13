// apps/tastebud/src/api/serviceRequests.ts
// "Call waiter": a guest at a table calls for staff (a waiter, the bill, water …). It shows up live on the
// restaurant's dashboard; the guest sees "On the way" once someone taps it there.
import { getTableKey } from '../utils/table';

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  ((typeof window !== 'undefined' && (window as any).__STORE__?.apiBase) as string | undefined) ||
  '/api/v1';

export type ServiceKind = 'waiter' | 'bill' | 'water' | 'cleanup' | 'other';
export type ServiceStatus = 'open' | 'acknowledged' | 'resolved';

export type PublicServiceRequest = {
  token: string;
  table: string;
  kind: ServiceKind;
  status: ServiceStatus;
  calls: number;
  createdAt: string;
  updatedAt: string;
};

export async function callForService(body: {
  subdomain: string;
  branch?: string | null;
  table: string;
  kind: ServiceKind;
  note?: string;
}): Promise<PublicServiceRequest> {
  const res = await fetch(`${API_BASE}/public/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      subdomain: body.subdomain,
      ...(body.branch ? { branch: body.branch } : {}),
      table: body.table,
      // the table's QR key: the staff know the guest really is at that table
      tableKey: getTableKey(body.subdomain, body.table) ?? undefined,
      kind: body.kind,
      ...(body.note?.trim() ? { note: body.note.trim().slice(0, 200) } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.request) throw new Error(data?.message || `HTTP ${res.status}`);
  return data.request as PublicServiceRequest;
}

export async function getServiceRequest(token: string): Promise<PublicServiceRequest | null> {
  const res = await fetch(`${API_BASE}/public/service-requests/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null; // gone
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // busy / down — ask again later
  const data = await res.json().catch(() => null);
  return (data?.request as PublicServiceRequest) ?? null;
}
