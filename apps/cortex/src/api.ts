// apps/cortex/src/api.ts — Cortex's calls to /api/v1/cortex/* (auth-service routes/cortexRoutes.ts).
// The admin's token lives in this browser only (12 hours); a 401 sends them back to sign-in.
const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';
const TOKEN_KEY = 'cortex:token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

export class SignedOut extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/cortex${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && !path.startsWith('/login')) {
    setToken(null);
    window.dispatchEvent(new Event('cortex:signed-out'));
    throw new SignedOut('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

export async function signIn(login: string, password: string): Promise<{ email: string }> {
  const r = await api<{ token: string; admin: { email: string } }>('/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  setToken(r.token);
  return r.admin;
}

/* ------------------------------------------------------------------ response shapes */

export type Rates = {
  visitToOrder: number | null;
  engagement: number | null;
  engagedToOrder: number | null;
  checkoutToOrder: number | null;
  scanToOrder: number | null;
  suggestionTake: number | null;
  checkoutAbandon: number | null;
  aiEngagedShareOfOrders: number | null;
};
export type Funnel = {
  sessions: number;
  pageViews: number;
  scans: number;
  scannedSessions: number;
  engagedSessions: number;
  aiTurns: number;
  suggestionsOpenedSessions: number;
  suggestionsAdded: number;
  itemsAdded: number;
  /** added something to the tray (or got to checkout / ordered) */
  cartSessions: number;
  checkoutSessions: number;
  orderedSessions: number;
  waiterCalls: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  rates: Rates;
};
export type OrderStats = {
  orders: number;
  completed: number;
  cancelled: number;
  revenue: number;
  avgOrderValue: number | null;
  byChannel: Record<string, number>;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
};
export type AiStats = {
  turns: number;
  conversations: number;
  unheardRate: number | null;
  fallbackRate: number | null;
  ordersByWaiter: number;
  upsell: { offers: number; accepted: number; takeRate: number | null; revenue: number };
};
export type Day = { day: string; sessions: number; engaged: number; checkout: number; orderedSessions: number; orders: number; revenue: number; scans: number };

export type Overview = {
  days: number;
  restaurants: { total: number; demos: number; onboarded: number; paying: number; onTrial: number; newInPeriod: number; activeInPeriod: number; branches: number };
  liveGuests: number;
  funnel: Funnel;
  orders: OrderStats;
  ai: AiStats;
  series: Day[];
  topRestaurants: Array<{ tenantId: string; name: string; subdomain: string; orders: number; revenue: number }>;
};

export type { BillingSummary } from './components/Billing';
import type { BillingSummary } from './components/Billing';

export type TenantRow = {
  id: string;
  name: string;
  subdomain: string;
  demo: boolean;
  owner: string | null;
  createdAt: string | null;
  onboarded: boolean;
  subscription: string;
  plan: string | null;
  trialEndsAt: string | null;
  billing: BillingSummary;
  channels: { dineIn: boolean; online: boolean };
  branches: number;
  lastActivity: string | null;
  sessions: number;
  scans: number;
  engagedSessions: number;
  checkoutSessions: number;
  orders: number;
  revenue: number;
  conversations: number;
  aiTurns: number;
  visitToOrder: number | null;
  engagedToOrder: number | null;
  avgMinutes: number | null;
};

export type SessionItem = {
  vid: string;
  tenantId: string;
  restaurant: string;
  subdomain: string;
  branch: string | null;
  channel: string;
  table: string | null;
  device: string | null;
  startedAt: string;
  lastAt: string;
  minutes: number;
  pageViews: number;
  scanned: boolean;
  aiTurns: number;
  suggestionsAdded: number;
  itemsAdded: number;
  checkout: boolean;
  ordered: boolean;
  orders: Array<{ token?: string; orderNumber?: number; total?: number }>;
  calls: number;
};

export type Turn = {
  at: string;
  input: 'typed' | 'voice';
  engine: string | null;
  heard: string;
  unheard: boolean;
  understood: {
    text: string | null;
    corrections: Array<{ from: string; to: string }>;
    language: string | null;
    intent: string | null;
    topic: string | null;
    actions: Array<{ op: string; name?: string; quantity?: number; variant?: string }>;
    mentioned: string[];
    suggested: string[];
    orderPlaced: boolean;
    orderNumber: number | null;
    upsellOffer: string | null;
  };
  said: string;
  flags: string[];
  branch: string | null;
  table: string | null;
  channel: string | null;
};

export type OrderItem = {
  id: string;
  tenantId?: string;
  restaurant?: string;
  orderNumber: number;
  status: string;
  total: number;
  channel: string;
  fulfillment?: string | null;
  branch: string | null;
  table: string | null;
  source: string | null;
  items: string | number | Array<{ name: string; qty: number; variation: string | null; lineTotal: number }>;
  createdAt: string;
};

export type ConversationItem = {
  id: string;
  tenantId: string | null;
  restaurant: string;
  subdomain: string;
  branch: string | null;
  table: string | null;
  channel: string | null;
  language: string | null;
  startedAt: string;
  lastAt: string;
  minutes: number;
  turns: number;
  unheard: number;
  ordered: boolean;
  preview: string;
};
