// services/auth-service/src/services/billing.ts
// What a restaurant pays Qravy, kept by hand (payments are collected outside the app — bKash, bank, cash):
//   - the plan's list price (Starter $29/mo · $290/yr, Pro $79/mo · $790/yr)
//   - a custom price, when one was agreed (typed in onboarding, or set / changed in Cortex) — with a note
//   - "paid until": each payment recorded in Cortex moves it on by a month (or a year)
//   - the status from the dates: trial → active → due soon (5 days before) → overdue (nothing is locked — the
//     restaurant sees a reminder, Cortex lists them)
//   - every change and payment kept, with who did it
import { ObjectId } from 'mongodb';

export type Money = { amount: number; currency: 'BDT' | 'USD' };
export type Billing = {
  customPrice?: (Money & { note?: string; setBy: string; at: Date }) | null;
  paidUntil?: Date | null;
  payments?: Array<Money & { id: string; at: Date; method: string; reference?: string; note?: string; by: string; months: number; paidUntil: Date }>;
  history?: Array<{ at: Date; by: string; what: string }>;
};
export type BillingStatus = 'none' | 'trial' | 'active' | 'due' | 'overdue';

const LIST: Record<string, Money & { interval: 'month' | 'year'; plan: string }> = {
  p1_m: { amount: 29, currency: 'USD', interval: 'month', plan: 'Starter' },
  p1_y: { amount: 290, currency: 'USD', interval: 'year', plan: 'Starter' },
  p2_m: { amount: 79, currency: 'USD', interval: 'month', plan: 'Pro' },
  p2_y: { amount: 790, currency: 'USD', interval: 'year', plan: 'Pro' },
};
export const DUE_SOON_DAYS = 5;
const DAY = 86_400_000;

export const money = (m: Money) => (m.currency === 'BDT' ? `৳${m.amount.toLocaleString('en-US')}` : `$${m.amount.toLocaleString('en-US')}`);

/** A custom price from a request body (or undefined when there isn't a valid one). */
export function parsePrice(v: unknown): (Money & { note?: string }) | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { amount?: unknown; currency?: unknown; note?: unknown };
  const amount = Math.round(Number(o.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return undefined;
  const currency = o.currency === 'USD' ? 'USD' : o.currency === 'BDT' ? 'BDT' : undefined;
  if (!currency) return undefined;
  const note = String(o.note ?? '').trim().slice(0, 200);
  return { amount, currency, ...(note ? { note } : {}) };
}

/** The summary everyone reads (Cortex lists, the restaurant's reminder): plan, prices, until when, status. */
export function billingSummary(t: { planInfo?: { planId?: string } | null; trialEndsAt?: Date | null; billing?: Billing | null }, now = Date.now()) {
  const planId = t.planInfo?.planId ?? null;
  const list = planId ? LIST[planId] ?? null : null;
  const b = t.billing ?? {};
  const custom = b.customPrice ?? null;
  const paidUntil = b.paidUntil ? new Date(b.paidUntil) : null;
  const trialEnds = t.trialEndsAt ? new Date(t.trialEndsAt) : null;
  const expiresAt = paidUntil ?? trialEnds;
  const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - now) / DAY) : null;
  let status: BillingStatus = 'none';
  if (planId || paidUntil) {
    if (paidUntil) status = daysLeft! < 0 ? 'overdue' : daysLeft! <= DUE_SOON_DAYS ? 'due' : 'active';
    else if (trialEnds) status = daysLeft! < 0 ? 'overdue' : 'trial';
  }
  return {
    planId,
    plan: list?.plan ?? null,
    interval: list?.interval ?? 'month',
    listPrice: list ? { amount: list.amount, currency: list.currency } : null,
    customPrice: custom ? { amount: custom.amount, currency: custom.currency, note: custom.note ?? '', setBy: custom.setBy, at: custom.at } : null,
    /** what they pay: the custom price when there is one */
    price: custom ? { amount: custom.amount, currency: custom.currency } : list ? { amount: list.amount, currency: list.currency } : null,
    paidUntil,
    trialEndsAt: trialEnds,
    expiresAt,
    daysLeft,
    status,
  };
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** billingSummary with ISO dates (what the API sends). */
export function billingDTO(t: object, now = Date.now()) {
  const s = billingSummary(t as Parameters<typeof billingSummary>[0], now);
  return {
    ...s,
    customPrice: s.customPrice ? { ...s.customPrice, at: iso(s.customPrice.at)! } : null,
    paidUntil: iso(s.paidUntil),
    trialEndsAt: iso(s.trialEndsAt),
    expiresAt: iso(s.expiresAt),
  };
}

export const newPaymentId = () => new ObjectId().toHexString();
export const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};
