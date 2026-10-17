// apps/cortex/src/components/Billing.tsx — what each restaurant pays Qravy, kept by hand (auth-service services/billing.ts):
// the plan's list price next to the price agreed with them (typed at onboarding, or changed here), "paid until" — each
// payment recorded here moves it on — and the status from the dates. Nothing is locked when it runs out; the restaurant
// sees a reminder and the list here shows who's due.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Card, fmt } from './ui';

export type Money = { amount: number; currency: 'BDT' | 'USD' };
export type BillingSummary = {
  planId: string | null;
  plan: string | null;
  interval: 'month' | 'year';
  listPrice: Money | null;
  customPrice: (Money & { note: string; setBy: string; at: string }) | null;
  price: Money | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'none' | 'trial' | 'active' | 'due' | 'overdue';
};
type Payment = Money & { id: string; at: string; method: string; reference?: string; note?: string; by: string; months: number; paidUntil: string };
type BillingView = BillingSummary & { payments: Payment[]; history: Array<{ at: string; by: string; what: string }> };

export const price = (m: Money | null | undefined) => (m ? `${m.currency === 'BDT' ? '৳' : '$'}${m.amount.toLocaleString('en-US')}` : '—');
const per = (b: BillingSummary) => (b.interval === 'year' ? '/yr' : '/mo');

/** The status as a badge: trial, paid, due soon, overdue. */
export function BillingBadge({ b }: { b?: BillingSummary }) {
  if (!b || b.status === 'none') return <Badge>no plan</Badge>;
  const left = b.daysLeft ?? 0;
  if (b.status === 'overdue') return <Badge tone="bad">overdue {Math.abs(left)}d</Badge>;
  if (b.status === 'due') return <Badge tone="warn">due in {left}d</Badge>;
  if (b.status === 'trial') return <Badge>trial · {left}d</Badge>;
  return <Badge tone="good">paid</Badge>;
}

/** For a table cell: what they pay, with the list price when a custom one was agreed. */
export function PriceCell({ b }: { b?: BillingSummary }) {
  if (!b?.price) return <span className="text-stone-400">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-stone-900">
        {price(b.price)}
        <span className="text-stone-500">{per(b)}</span>
      </span>
      {b.customPrice && b.listPrice && (
        <span className="ml-1 text-[11px] text-stone-400 line-through" title={`List price · custom: ${b.customPrice.note || 'no note'}`}>
          {price(b.listPrice)}
        </span>
      )}
    </span>
  );
}

const input = 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-stone-500';

/** The restaurant page's card: price (change it), paid until, record a payment, payments and the change log. */
export function BillingCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing', tenantId], queryFn: () => api<{ billing: BillingView }>(`/restaurants/${tenantId}/billing`) });
  const [mode, setMode] = useState<'none' | 'price' | 'payment'>('none');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'BDT' | 'USD'>('BDT');
  const [note, setNote] = useState('');
  const [months, setMonths] = useState('1');
  const [method, setMethod] = useState('bKash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const b = q.data?.billing;

  const start = (m: 'price' | 'payment') => {
    const base = m === 'price' ? b?.customPrice ?? b?.listPrice : b?.price;
    setAmount(base ? String(base.amount) : '');
    setCurrency(base?.currency ?? 'BDT');
    setNote(m === 'price' ? b?.customPrice?.note ?? '' : '');
    setMonths(b?.interval === 'year' ? '12' : '1');
    setReference('');
    setError('');
    setMode(m);
  };
  const send = async (path: string, method: 'PUT' | 'POST', body: unknown) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ billing: BillingView }>(path, { method, body: JSON.stringify(body) });
      qc.setQueryData(['billing', tenantId], r);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      void qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
      setMode('none');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const savePrice = () => send(`/restaurants/${tenantId}/billing`, 'PUT', { customPrice: { amount: Number(amount), currency, note } });
  const clearPrice = () => send(`/restaurants/${tenantId}/billing`, 'PUT', { customPrice: null });
  const recordPayment = () =>
    send(`/restaurants/${tenantId}/payments`, 'POST', { amount: Number(amount), currency, months: Number(months), method, reference, note });

  return (
    <Card title="Billing" right={b && <BillingBadge b={b} />}>
      {!b ? (
        <p className="text-[13px] text-stone-500">{q.error ? (q.error as Error).message : 'Loading…'}</p>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-stone-500">Plan</div>
              <div className="mt-0.5 font-medium text-stone-900">{b.plan ? `${b.plan} · ${b.interval === 'year' ? 'yearly' : 'monthly'}` : '—'}</div>
              <div className="text-stone-500">list {price(b.listPrice)}{b.listPrice ? per(b) : ''}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-stone-500">They pay</div>
              <div className="mt-0.5 font-medium text-stone-900">
                {price(b.price)}
                {b.price ? per(b) : ''}
              </div>
              <div className="text-stone-500">
                {b.customPrice ? `custom${b.customPrice.note ? ` — ${b.customPrice.note}` : ''}` : 'list price'}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-stone-500">{b.paidUntil ? 'Paid until' : 'Trial ends'}</div>
              <div className="mt-0.5 font-medium text-stone-900">{fmt.date(b.expiresAt)}</div>
              <div className="text-stone-500">
                {b.daysLeft == null ? '' : b.daysLeft < 0 ? `${Math.abs(b.daysLeft)} days ago` : `in ${b.daysLeft} days`}
              </div>
            </div>
            <div className="flex flex-wrap items-start justify-end gap-2">
              <button type="button" onClick={() => start('payment')} className="rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white hover:opacity-90">
                Record payment
              </button>
              <button type="button" onClick={() => start('price')} className="rounded-md border border-stone-300 px-3 py-1.5 text-stone-800 hover:bg-stone-50">
                Change price
              </button>
            </div>
          </div>

          {b.customPrice && (
            <p className="text-[12px] text-stone-500">
              Custom price set by {b.customPrice.setBy} on {fmt.date(b.customPrice.at)}.{' '}
              <button type="button" disabled={busy} onClick={() => void clearPrice()} className="text-red-700 underline">
                Back to list price
              </button>
            </p>
          )}

          {mode !== 'none' && (
            <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
              <div className="mb-2 font-medium text-stone-900">{mode === 'price' ? `Agreed price (${b.interval === 'year' ? 'per year' : 'per month'})` : 'Payment received'}</div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={currency} onChange={(e) => setCurrency(e.target.value === 'USD' ? 'USD' : 'BDT')} className={input} aria-label="Currency">
                  <option value="BDT">৳ BDT</option>
                  <option value="USD">$ USD</option>
                </select>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Amount" className={`${input} w-28`} />
                {mode === 'payment' && (
                  <>
                    <label className="flex items-center gap-1 text-stone-600">
                      for
                      <input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" aria-label="Months" className={`${input} w-14`} />
                      month(s)
                    </label>
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className={input} aria-label="Method">
                      {['bKash', 'Nagad', 'Bank transfer', 'Cash', 'Card', 'Other'].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID (optional)" aria-label="Reference" className={`${input} w-48`} />
                  </>
                )}
                <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Note (optional)" aria-label="Note" className={`${input} min-w-0 flex-1`} />
              </div>
              {mode === 'payment' && (
                <p className="mt-1.5 text-[12px] text-stone-500">
                  Paid until moves on by {Number(months) || 0} month(s) from {b.paidUntil && new Date(b.paidUntil) > new Date() ? fmt.date(b.paidUntil) : 'today'}.
                </p>
              )}
              {error && <p className="mt-1.5 text-red-700">{error}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setMode('none')} className="rounded-md px-2.5 py-1.5 text-stone-600 hover:bg-stone-100">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void (mode === 'price' ? savePrice() : recordPayment())}
                  className="rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                >
                  {busy ? 'Saving…' : mode === 'price' ? 'Save price' : 'Record payment'}
                </button>
              </div>
            </div>
          )}

          {b.payments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[11px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="pb-2 pr-3 font-semibold">Date</th>
                    <th className="pb-2 pr-3 font-semibold">Amount</th>
                    <th className="pb-2 pr-3 font-semibold">Method</th>
                    <th className="pb-2 pr-3 font-semibold">Covers</th>
                    <th className="pb-2 pr-3 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody>
                  {b.payments.map((p) => (
                    <tr key={p.id} className="border-t border-stone-100 align-top">
                      <td className="py-2 pr-3 text-stone-700">{fmt.date(p.at)}</td>
                      <td className="py-2 pr-3 font-medium text-stone-900">{price(p)}</td>
                      <td className="py-2 pr-3 text-stone-700">
                        {p.method}
                        {p.reference && <div className="text-[11px] text-stone-400">{p.reference}</div>}
                      </td>
                      <td className="py-2 pr-3 text-stone-700">
                        {p.months} mo → {fmt.date(p.paidUntil)}
                        {p.note && <div className="text-[11px] text-stone-400">{p.note}</div>}
                      </td>
                      <td className="py-2 pr-3 text-stone-500">{p.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {b.history.length > 0 && (
            <details className="text-[12px] text-stone-600">
              <summary className="cursor-pointer text-stone-500">Change log ({b.history.length})</summary>
              <ul className="mt-1.5 space-y-0.5">
                {b.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-stone-400">{fmt.time(h.at)}</span> · {h.what} <span className="text-stone-400">— {h.by}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
