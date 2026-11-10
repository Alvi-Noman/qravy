/**
 * Riders API (staff) — the restaurant's own delivery riders: the list (Riders page), handing a delivery order to one
 * and doing their steps for them (the order board). Riders never sign in: each has a private link to their page.
 */
import api from './auth';
import type { AdminOrder } from './orders';

export type RiderVehicle = 'bike' | 'cycle' | 'car' | 'walk';

export type Rider = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  vehicle: RiderVehicle | null;
  /** null = rides for every branch */
  locationId: string | null;
  onDuty: boolean;
  linkToken: string;
  cashHandedAt: string | null;
  deliveredToday: number;
  /** the deliveries they're on now */
  active: { orderNumber: number; pickedUp: boolean }[];
  cashHolding: number;
};

export type RiderInput = {
  name?: string;
  phone?: string;
  photoUrl?: string | null;
  vehicle?: RiderVehicle | null;
  locationId?: string | null;
  onDuty?: boolean;
};

export async function listRiders(): Promise<Rider[]> {
  const res = await api.get('/api/v1/riders');
  return (res.data?.riders ?? []) as Rider[];
}

export async function createRider(input: RiderInput): Promise<Rider> {
  const res = await api.post('/api/v1/riders', input);
  return res.data?.rider as Rider;
}

export async function updateRider(id: string, input: RiderInput): Promise<Rider> {
  const res = await api.patch(`/api/v1/riders/${encodeURIComponent(id)}`, input);
  return res.data?.rider as Rider;
}

export async function removeRider(id: string): Promise<void> {
  await api.delete(`/api/v1/riders/${encodeURIComponent(id)}`);
}

export async function resetRiderLink(id: string): Promise<Rider> {
  const res = await api.post(`/api/v1/riders/${encodeURIComponent(id)}/reset-link`, {});
  return res.data?.rider as Rider;
}

export async function settleRiderCash(id: string): Promise<{ settledOrders: number }> {
  const res = await api.post(`/api/v1/riders/${encodeURIComponent(id)}/settle-cash`, {});
  return res.data as { settledOrders: number };
}

/** Hand a delivery order to a rider (null: take it back). */
export async function assignOrderRider(orderId: string, riderId: string | null): Promise<AdminOrder> {
  const res = await api.post(`/api/v1/orders/${encodeURIComponent(orderId)}/rider`, { riderId });
  return res.data?.order as AdminOrder;
}

/** Staff do the rider's step for them (they forgot to tap). */
export async function orderTrip(orderId: string, action: 'picked_up' | 'delivered'): Promise<AdminOrder> {
  const res = await api.post(`/api/v1/orders/${encodeURIComponent(orderId)}/trip`, { action });
  return res.data?.order as AdminOrder;
}

/* ---------- the rider's link, and the WhatsApp message staff send ---------- */

/** The rider app (apps/rider): rider.qravy.com in production; VITE_RIDER_APP_URL overrides it. */
export function riderAppBase(): string {
  const env = (import.meta.env.VITE_RIDER_APP_URL as string | undefined)?.trim();
  return (env || (import.meta.env.DEV ? 'http://localhost:5610' : 'https://rider.qravy.com')).replace(/\/+$/, '');
}

/** A rider's own link: opens their deliveries in the app (or the browser), and signs the installed app in. */
export function riderLink(link: string): string {
  return `${riderAppBase()}/r/${link}`;
}

/** The Android app (a thin wrapper around the rider app — apps/rider/android), served by the rider app itself. */
export function riderApkUrl(): string {
  return `${riderAppBase()}/download/qravy-rider.apk`;
}

/** Bangladesh numbers as WhatsApp wants them: 01711… → 8801711… */
export function waNumber(phone: string): string {
  const d = phone.replace(/[^0-9]/g, '');
  if (d.startsWith('880')) return d;
  if (d.startsWith('0')) return `88${d}`;
  return d;
}

/** A WhatsApp link that opens the chat with the rider, the message written (staff press send). */
export function whatsappTo(phone: string, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

export const REASON_LABEL: Record<string, string> = {
  'no-answer': 'Customer not answering',
  'wrong-address': 'Wrong address',
  refused: 'Customer refused',
  other: 'Other problem',
};

export const VEHICLE_LABEL: Record<RiderVehicle, string> = { bike: 'Bike', cycle: 'Cycle', car: 'Car', walk: 'On foot' };
