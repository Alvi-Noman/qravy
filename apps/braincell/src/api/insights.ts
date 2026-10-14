// apps/braincell/src/api/insights.ts — the restaurant's own performance (auth-service routes/insightsRoutes.ts).
// A branch login always gets its branch; owners / admins pass `location` (one branch) or nothing (all combined).
import api from './auth';

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

export type InsightsOverview = {
  days: number;
  branch: string | null;
  timezone: string;
  funnel: {
    sessions: number;
    pageViews: number;
    scans: number;
    scannedSessions: number;
    engagedSessions: number;
    aiTurns: number;
    suggestionsAdded: number;
    itemsAdded: number;
    cartSessions: number;
    checkoutSessions: number;
    orderedSessions: number;
    waiterCalls: number;
    avgMinutes: number | null;
    medianMinutes: number | null;
    rates: Rates;
  };
  orders: {
    orders: number;
    completed: number;
    cancelled: number;
    revenue: number;
    avgOrderValue: number | null;
    byChannel: Record<string, number>;
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
  };
  ai: {
    turns: number;
    conversations: number;
    unheardRate: number | null;
    fallbackRate: number | null;
    ordersByWaiter: number;
    upsell: { offers: number; accepted: number; takeRate: number | null; revenue: number };
  };
  waiterCalls: number;
  series: Array<{ day: string; sessions: number; engaged: number; checkout: number; orderedSessions: number; orders: number; revenue: number; scans: number }>;
  byHour: Array<{ hour: number; orders: number; revenue: number }>;
  byWeekday: Array<{ day: string; orders: number }>;
  topItems: Array<{ itemId: string; name: string; qty: number; revenue: number }>;
  byBranch: Array<{ locationId: string; branch: string; orders: number; revenue: number; dineIn: number; online: number; sessions: number; visitToOrder: number | null }>;
};

export type MenuInsight = {
  itemId: string;
  name: string;
  category: string | null;
  price: number | null;
  active: boolean;
  qty: number;
  revenue: number;
  revenueShare: number;
  inOrders: number;
  orderShare: number;
  byWaiter: number;
  dineIn: number;
  online: number;
  addedToTray: number;
  suggestedAdds: number;
  lastSold: string | null;
};

const qs = (days: number, location?: string | null, channel?: string | null) =>
  new URLSearchParams({ days: String(days), ...(location ? { location } : {}), ...(channel ? { channel } : {}) }).toString();

export async function getInsights(days: number, location?: string | null, channel?: string | null): Promise<InsightsOverview> {
  const res = await api.get(`/api/v1/insights/overview?${qs(days, location, channel)}`);
  return res.data as InsightsOverview;
}

export async function getMenuInsights(days: number, location?: string | null, channel?: string | null): Promise<{ orders: number; items: MenuInsight[] }> {
  const res = await api.get(`/api/v1/insights/menu?${qs(days, location, channel)}`);
  return res.data as { orders: number; items: MenuInsight[] };
}

/* ------------------------------------------------------------------ the home dashboard */

export type DashRange = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export type DashSummary = {
  scans: number;
  guests: number;
  scannedGuests: number;
  uniqueDevices: number;
  returningGuests: number;
  newGuests: number;
  engagedGuests: number;
  cartGuests: number;
  checkoutGuests: number;
  orderingGuests: number;
  conversion: number | null;
  scanToOrder: number | null;
  engagement: number | null;
  bounceRate: number | null;
  avgMinutes: number | null;
  medianMinutes: number | null;
  pagesPerGuest: number | null;
  waiterCalls: number;
  orders: number;
  cancelled: number;
  revenue: number;
  avgOrderValue: number | null;
  aiOrders: number;
};

export type DashPoint = {
  key: string;
  scans: number;
  guests: number;
  dineInGuests: number;
  onlineGuests: number;
  orders: number;
  dineInOrders: number;
  onlineOrders: number;
  revenue: number;
};

export type Dashboard = {
  period: { key: DashRange; from: string; to: string; bucket: 'hour' | 'day'; includesNow: boolean; timezone: string };
  branch: string | null;
  channel: 'dine-in' | 'online' | null;
  now: { total: number; dineIn: number; online: number } | null;
  summary: DashSummary;
  previous: DashSummary;
  channels: Record<'dine-in' | 'online', { current: DashSummary; previous: DashSummary; funnel: InsightsOverview['funnel'] }>;
  series: DashPoint[];
  prevSeries: DashPoint[];
  byHour: Array<{ hour: number; scans: number; guests: number; orders: number }>;
  tables: Array<{ table: string; scans: number; guests: number; ordered: number; conversion: number | null; avgMinutes: number }>;
  devices: Record<string, number>;
  branches: Array<{
    locationId: string;
    name: string;
    scans: number;
    guests: number;
    dineInGuests: number;
    onlineGuests: number;
    orders: number;
    revenue: number;
    conversion: number | null;
    avgMinutes: number | null;
  }>;
};

export async function getDashboard(opts: {
  range: DashRange;
  from?: string;
  to?: string;
  location?: string | null;
  channel?: string | null;
}): Promise<Dashboard> {
  const q = new URLSearchParams({ range: opts.range });
  if (opts.range === 'custom' && opts.from) q.set('from', opts.from);
  if (opts.range === 'custom' && opts.to) q.set('to', opts.to);
  if (opts.location) q.set('location', opts.location);
  if (opts.channel) q.set('channel', opts.channel);
  return (await api.get(`/api/v1/insights/dashboard?${q}`)).data as Dashboard;
}
