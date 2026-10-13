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
