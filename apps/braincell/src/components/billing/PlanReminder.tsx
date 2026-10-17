// apps/braincell/src/components/billing/PlanReminder.tsx — the plan's reminder across the top of the dashboard when what
// the restaurant paid Qravy runs out (auth-service services/billing.ts): amber 5 days before, red once it has passed.
// Nothing is locked; it can be hidden for the day.
import { useState } from 'react';
import type { TenantBilling } from '../../../../../packages/shared/src/types/v1';

const fmtMoney = (m: { amount: number; currency: 'BDT' | 'USD' }) =>
  `${m.currency === 'BDT' ? '৳' : '$'}${m.amount.toLocaleString('en-US')}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);

export default function PlanReminder({ billing }: { billing?: TenantBilling }) {
  const key = `plan-reminder-hidden:${billing?.expiresAt ?? ''}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === today();
    } catch {
      return false;
    }
  });
  if (!billing?.expiresAt || hidden) return null;
  const left = billing.daysLeft ?? 0;
  const custom = !!billing.customPrice;
  // a negotiated price has no card paywall: its trial gets the same heads-up
  const show = billing.status === 'due' || billing.status === 'overdue' || (custom && billing.status === 'trial' && left <= 5);
  if (!show) return null;

  const overdue = billing.status === 'overdue';
  const what = billing.paidUntil ? 'Your Qravy plan' : 'Your free trial';
  const when = fmtDate(billing.expiresAt);
  const price = billing.price ? ` · ${fmtMoney(billing.price)}/${billing.interval === 'year' ? 'yr' : 'mo'}` : '';
  const hide = () => {
    try {
      localStorage.setItem(key, today());
    } catch {
      /* hides for this visit only */
    }
    setHidden(true);
  };
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[13px] ${
        overdue ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <span className="font-semibold">{overdue ? `${what} ended on ${when}` : `${what} ends on ${when}${left > 0 ? ` (${left} day${left === 1 ? '' : 's'})` : ''}`}</span>
      <span className="opacity-80">
        {billing.plan ? `${billing.plan}${price}` : ''} — contact Qravy to renew. Everything keeps working meanwhile.
      </span>
      <button type="button" onClick={hide} className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium hover:bg-black/5">
        Hide for today
      </button>
    </div>
  );
}
