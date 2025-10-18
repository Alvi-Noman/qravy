// apps/braincell/src/api/billing.ts
import api from './auth';

// Self-contained mock billing API with an internal sleep helper.
// (We now also expose real backend calls for subscribing.)
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export type BillingInterval = 'month' | 'year';
export type PlanTier = 'Free' | 'Starter' | 'Pro' | 'Business' | 'Enterprise';
export type AddOnKey = 'analytics' | 'white_label' | 'priority_support' | 'multi_venue' | 'ai_assistant';

export type PlanState = {
  tier: PlanTier;
  interval: BillingInterval;
  seats: number;
  addOns: Record<AddOnKey, boolean>;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  renewsAt: string;
  trialEndsAt?: string;
};

export type Usage = {
  menuItems: { used: number; limit: number };
  storageMB: { used: number; limit: number };
  apiCalls: { used: number; limit: number };
  staffSeats: { used: number; limit: number };
};

export type PaymentMethod = {
  id: string;
  brand: string; // e.g., 'visa'
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export type BillingProfile = {
  companyName: string;
  billingEmail: string;
  extraEmails: string[];
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  taxId?: string;
  taxExempt?: 'none' | 'exempt' | 'reverse';
  dunningEnabled: boolean;
  dunningDays: number[];
};

export type Invoice = {
  id: string;
  number: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  amountDue: number; // cents
  currency: string; // 'usd'
  issuedAt: string;
  hostedInvoiceUrl?: string;
  pdfUrl?: string;
};

const now = new Date();
const samplePlan: PlanState = {
  tier: 'Pro',
  interval: 'month',
  seats: 8,
  addOns: { analytics: true, white_label: false, priority_support: true, multi_venue: false, ai_assistant: false },
  status: 'active',
  renewsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
};

const sampleUsage: Usage = {
  menuItems: { used: 184, limit: 500 },
  storageMB: { used: 920, limit: 5000 },
  apiCalls: { used: 18234, limit: 50000 },
  staffSeats: { used: 7, limit: 10 },
};

const sampleBilling: BillingProfile = {
  companyName: 'Demo Restaurant LLC',
  billingEmail: 'owner@demo.example',
  extraEmails: ['billing@demo.example'],
  address: {
    line1: '123 Market St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
  },
  taxId: 'US-12-3456789',
  taxExempt: 'none',
  dunningEnabled: true,
  dunningDays: [3, 7, 14],
};

const samplePMs: PaymentMethod[] = [
  { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2027, isDefault: true },
  { id: 'pm_2', brand: 'mastercard', last4: '4444', expMonth: 7, expYear: 2026, isDefault: false },
];

const sampleInvoices: Invoice[] = Array.from({ length: 10 }).map((_, i) => ({
  id: `in_${i + 1}`,
  number: `INV-${2024000 + i}`,
  status: i < 7 ? 'paid' : i === 7 ? 'open' : 'uncollectible',
  amountDue: 12900 + i * 500, // cents
  currency: 'usd',
  issuedAt: new Date(Date.now() - i * 86400_000 * 30).toISOString(),
  hostedInvoiceUrl: '#',
  pdfUrl: '#',
}));

export async function getPlan(): Promise<{ plan: PlanState; usage: Usage }> {
  await sleep(350);
  return { plan: samplePlan, usage: sampleUsage };
}

export async function updatePlan(next: PlanState): Promise<PlanState> {
  await sleep(600);
  Object.assign(samplePlan, next);
  return samplePlan;
}

export async function getBilling(): Promise<BillingProfile> {
  await sleep(300);
  return sampleBilling;
}

export async function updateBilling(profile: BillingProfile): Promise<BillingProfile> {
  await sleep(600);
  Object.assign(sampleBilling, profile);
  return sampleBilling;
}

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  await sleep(250);
  return samplePMs.map((p) => ({ ...p }));
}

export async function addPaymentMethod(fakeToken: string): Promise<PaymentMethod> {
  await sleep(600);
  const last4 = /\d{4}$/.test(fakeToken) ? fakeToken.slice(-4) : '0000';
  const pm: PaymentMethod = {
    id: `pm_${Math.random().toString(36).slice(2, 8)}`,
    brand: 'visa',
    last4,
    expMonth: 12,
    expYear: 2029,
    isDefault: false,
  };
  samplePMs.push(pm);
  return pm;
}

export async function setDefaultPaymentMethod(id: string): Promise<void> {
  await sleep(300);
  samplePMs.forEach((p) => (p.isDefault = p.id === id));
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await sleep(300);
  const idx = samplePMs.findIndex((p) => p.id === id);
  if (idx >= 0) samplePMs.splice(idx, 1);
}

export async function listInvoices(): Promise<Invoice[]> {
  await sleep(300);
  return sampleInvoices.map((i) => ({ ...i }));
}

export async function getUpcomingInvoiceEstimate(
  plan: PlanState
): Promise<{ amountDue: number; currency: string; prorationNotice?: string }> {
  await sleep(300);

  // Base per month (cents) from tier
  const basePerMonth =
    plan.tier === 'Free' ? 0 :
    plan.tier === 'Starter' ? 2900 :
    plan.tier === 'Pro' ? 7900 :
    plan.tier === 'Business' ? 24900 : 0;

  const seatAllowance = 3; // included seats before charging extra
  const seatCostPerMonth = Math.max(0, plan.seats - seatAllowance) * 700;

  const addOnCostPerMonth =
    (plan.addOns.analytics ? 2000 : 0) +
    (plan.addOns.white_label ? 3000 : 0) +
    (plan.addOns.priority_support ? 1500 : 0) +
    (plan.addOns.multi_venue ? 4000 : 0) +
    (plan.addOns.ai_assistant ? 1200 : 0);

  const monthlySubtotal = basePerMonth + seatCostPerMonth + addOnCostPerMonth;

  // Yearly = 2 months free -> 10 x monthly
  const amountDue = plan.interval === 'year' ? Math.round(monthlySubtotal * 10) : monthlySubtotal;

  return {
    amountDue,
    currency: 'usd',
    prorationNotice: 'Includes proration estimate based on your current cycle.',
  };
}

/* -----------------------------------------------------------------------------
   Plan catalog + resolver used by Paywall/Plan page to show correct price
----------------------------------------------------------------------------- */

export type CatalogEntry = {
  id: string;
  name: string;
  currency: 'usd';
  monthlyCents: number;
  yearlyCents: number;
};

// p1 = Starter, p2 = Pro (2 months free on yearly)
export const PLAN_CATALOG: Record<string, CatalogEntry> = {
  p1: { id: 'p1', name: 'Starter', currency: 'usd', monthlyCents: 2900, yearlyCents: 29000 },
  p2: { id: 'p2', name: 'Pro',     currency: 'usd', monthlyCents: 7900, yearlyCents: 79000 },
};

/**
 * Convert a backend planId to a priced plan object for the UI.
 * Accepts: 'p1_m','p1_y','p2_m','p2_y', and legacy 'p1'/'p2' as well as 'starter'/'pro'.
 */
export function planInfoFromId(planId: string | undefined): {
  id: string;
  name: string;
  interval: 'month' | 'year';
  priceCents: number;
  currency: string;
} {
  if (!planId) {
    const c = PLAN_CATALOG.p1;
    return { id: 'p1_m', name: c.name, interval: 'month', priceCents: c.monthlyCents, currency: c.currency };
  }

  // Legacy mapping: p1->p1, p2->p2, starter->p1, pro->p2
  const legacyBaseMap: Record<string, 'p1' | 'p2'> = { p1: 'p1', p2: 'p2', starter: 'p1', pro: 'p2' };

  const raw = planId.toLowerCase();
  const isYear = /(_y|_year|:y|:year|year|yearly)$/.test(raw);
  const isMonth = /(_m|_month|:m|:month|month|monthly)$/.test(raw);

  const baseRaw = raw.replace(/(_m|_y|_month|_year|:m|:y|:month|:year|month|monthly|year|yearly)$/g, '');
  const base = legacyBaseMap[baseRaw] ?? baseRaw;

  const cat = PLAN_CATALOG[base] ?? PLAN_CATALOG.p1;

  let interval: 'month' | 'year' = 'month';
  if (isYear) interval = 'year';
  else if (isMonth) interval = 'month';
  // default remains month if no suffix

  return {
    id: planId,
    name: cat.name,
    interval,
    priceCents: interval === 'year' ? cat.yearlyCents : cat.monthlyCents,
    currency: cat.currency,
  };
}

/* -----------------------------------------------------------------------------
   Backend integration (tenant subscribe)
----------------------------------------------------------------------------- */

// What the FE can send when subscribing (includes non-sensitive payment meta)
export type SubscribeTenantRequest = {
  planId: string;              // 'p1_m' | 'p2_y' etc.
  interval?: 'month' | 'year'; // optional, backend normalizes if absent
  cardToken?: string;          // optional (dummy)
  name?: string;               // optional (cardholder)
  amountCents?: number;        // optional
  currency?: string;           // optional

  // Save non-sensitive card meta on subscribe:
  payment?: {
    provider?: 'mock' | 'stripe' | 'adyen' | 'none';
    brand?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';
    last4?: string;
    expMonth?: number;
    expYear?: number;
    country?: string;
    funding?: 'credit' | 'debit' | 'prepaid' | 'unknown';
    paymentMethodId?: string; // optional
    customerId?: string;      // optional
  };
};

// What we expect back (subset of backend TenantDTO)
export type TenantDTO = {
  planInfo?: { planId?: string };
  subscriptionStatus?: 'none' | 'active';
  trialEndsAt?: string | null;
  hasCardOnFile?: boolean;
  payment?: {
    provider?: 'none' | 'stripe' | 'adyen' | 'mock';
    customerId?: string;
    defaultPaymentMethodId?: string;
    brand?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';
    last4?: string;
    expMonth?: number;
    expYear?: number;
    country?: string;
    funding?: 'credit' | 'debit' | 'prepaid' | 'unknown';
    updatedAt?: string;
  };
};

export async function subscribeTenant(body: SubscribeTenantRequest): Promise<TenantDTO> {
  const { data } = await api.post<{ item: TenantDTO }>('/api/v1/auth/tenants/subscribe', body);
  return data.item;
}