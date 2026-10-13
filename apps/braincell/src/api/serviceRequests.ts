/**
 * Service requests (staff): a guest at a table pressed "Call waiter" (the bill, water, clean the table …).
 * They arrive live on the orders stream (service.created / service.updated); staff tap On my way → Done.
 */
import api from './auth';

export type ServiceRequestKind = 'waiter' | 'bill' | 'water' | 'cleanup' | 'other';
export type ServiceRequestStatus = 'open' | 'acknowledged' | 'resolved';

export type ServiceRequest = {
  id: string;
  table: string;
  /** false: the guest typed the table number instead of scanning its QR code */
  tableVerified: boolean;
  kind: ServiceRequestKind;
  note: string | null;
  status: ServiceRequestStatus;
  /** How many times the guest called (pressed again while it was still open) */
  calls: number;
  lastCalledAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  locationId: string | null;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SERVICE_KIND_LABEL: Record<ServiceRequestKind, string> = {
  waiter: 'Call waiter',
  bill: 'Bring the bill',
  water: 'Water',
  cleanup: 'Clean the table',
  other: 'Other',
};

export async function listServiceRequests(token: string): Promise<ServiceRequest[]> {
  const res = await api.get('/api/v1/service-requests', { headers: { Authorization: `Bearer ${token}` } });
  return (res.data?.requests ?? []) as ServiceRequest[];
}

export async function updateServiceRequestStatus(
  token: string,
  id: string,
  status: 'acknowledged' | 'resolved',
): Promise<ServiceRequest> {
  const res = await api.post(
    `/api/v1/service-requests/${encodeURIComponent(id)}/status`,
    { status },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.data?.request as ServiceRequest;
}
