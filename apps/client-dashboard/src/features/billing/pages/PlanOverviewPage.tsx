// apps/client-dashboard/src/features/billing/pages/PlanOverviewPage.tsx
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckIcon,
  ClockIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { usePlanQuery, useUpdatePlanMutation } from '../hooks/usePlan';
import type { PlanState, PlanTier } from '../../../api/billing';
import api from '../../../api/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../../context/AuthContext';

function formatDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '—';
  }
}

// Full service list we want to show
const services = [
  'Customizable Digital Menu',
  'Real-Time Availability Display',
  'In-Restaurant Ordering',
  'Call Waiter with a Single Tap',
  'AI Waiter Assistant',
  'AI-Powered Dish Recommendations',
  'Smart Upselling',
  'Multilingual Support',
  'Promotions & Deals',
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
] as const;
type Service = (typeof services)[number];

const disabledInStarter = new Set<Service>([
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
]);

// What each tier includes
const includedByTier: Record<PlanTier, Set<Service>> = {
  Free: new Set<Service>(['Customizable Digital Menu', 'Multilingual Support']),
  Starter: new Set<Service>(services.filter((s) => !disabledInStarter.has(s)) as Service[]),
  Pro: new Set<Service>(services),
  Business: new Set<Service>(services),
  Enterprise: new Set<Service>(services),
};

// Small helper to format USD currency from dollars
function formatUsd(amountDollars: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountDollars);
}

const catalog: Record<
  PlanTier,
  { label: string; priceM: number; includesSeats: number }
> = {
  Free: { label: 'Free', priceM: 0, includesSeats: 1 },
  Starter: { label: 'Starter', priceM: 29, includesSeats: 3 },
  Pro: { label: 'Pro', priceM: 99, includesSeats: 5 },
  Business: { label: 'Business', priceM: 249, includesSeats: 10 },
  Enterprise: { label: 'Enterprise', priceM: 0, includesSeats: 25 },
};

export default function PlanOverviewPage(): JSX.Element {
  const navigate = useNavigate();
  const { data: plan, isLoading } = usePlanQuery();
  const { mutateAsync: savePlan } = useUpdatePlanMutation();

  // Tenant cache handle
  const qc = useQueryClient();
  const { token } = useAuthContext();

  // Cancel modal
  const [cancelOpen, setCancelOpen] = useState(false);

  const entry = plan ? catalog[plan.tier] : null;

  const priceLine = useMemo(() => {
    if (!plan || !entry) return '';
    if (plan.tier === 'Enterprise') return 'Custom';
    const m = entry.priceM;
    if (plan.interval === 'month') return `${formatUsd(m)} / month`;
    const y = Math.round(m * 12 * 0.85);
    return `${formatUsd(y)} / year`;
  }, [plan, entry]);

  const statusChip =
    plan?.status === 'active'
      ? { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : plan?.status === 'trialing'
      ? { label: 'Trialing', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
      : plan?.status === 'past_due'
      ? { label: 'Past due', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      : plan?.status === 'paused'
      ? { label: 'Paused', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
      : { label: 'Canceled', cls: 'bg-rose-50 text-rose-700 border-rose-200' };

  const openSelector = () => navigate('/settings/plan/select?step=select');

  // Cancel subscription (redirect to /dashboard on success)
  async function confirmCancelSubscription(_: { reason: string; details?: string }) {
    if (!plan) return;
    // Cancel immediately
    await api.post('/api/v1/auth/tenants/cancel', { mode: 'immediate' });

    // reflect locally
    await savePlan({ ...plan, status: 'canceled' });

    // refresh tenant so the global paywall reacts
    if (token) qc.invalidateQueries({ queryKey: ['tenant', token] });
    else qc.invalidateQueries({ queryKey: ['tenant'] });

    // redirect to dashboard so the global paywall can take over
    navigate('/dashboard', { replace: true });
  }

  if (isLoading || !plan || !entry) {
    return (
      <div className="grid gap-4 pb-4">
        <div className="h-10 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-40 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  const includedSet = includedByTier[plan.tier];

  // Visible services list: remove the three from Starter completely
  const visibleServices: Service[] =
    plan.tier === 'Starter'
      ? (services.filter((s) => !disabledInStarter.has(s)) as Service[])
      : (Array.from(services) as Service[]);

  return (
    <div className="grid gap-4 pb-4">
      {/* Hero summary */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-[18px] font-semibold text-slate-900">{entry.label}</div>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusChip.cls}`}>
                {statusChip.label}
              </span>
            </div>
            <div className="text-[20px] font-bold text-slate-900">{priceLine}</div>
            {entry.priceM > 0 && plan.tier !== 'Enterprise' && (
              <div className="text-[12px] text-slate-600">
                {/* No switch here — just show current interval and seats */}
                {plan.interval === 'year' ? 'Billed yearly' : 'Billed monthly'} • Includes {entry.includesSeats} seats
              </div>
            )}
            <div className="mt-1 inline-flex items-center gap-1 text-[12px] text-slate-600">
              <ClockIcon className="h-4 w-4" />
              <span>Renews on {formatDate(plan.renewsAt)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openSelector}
              className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
            >
              Change plan
            </button>
            <Link
              to="/settings/billing"
              className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
            >
              Manage billing
            </Link>
          </div>
        </div>

        {/* Removed the Billing interval switch block */}
      </div>

      {/* What’s included */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">What’s included</div>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleServices.map((s) => {
            const included = includedSet.has(s as Service);
            return (
              <li
                key={s}
                className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {included ? (
                    <CheckIcon className="h-4 w-4 text-slate-700" />
                  ) : (
                    <XMarkIcon className="h-4 w-4 text-slate-400" />
                  )}
                  <span className={`${included ? 'text-slate-800' : 'text-slate-400 line-through'} text-[13px]`}>
                    {s}
                  </span>
                </div>
                {!included && plan.tier !== 'Enterprise' && (
                  <button
                    className="text-[12px] text-slate-700 underline underline-offset-2"
                    onClick={openSelector}
                  >
                    Upgrade
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Subscription controls */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm mb-2">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">Subscription controls</div>
          <Link to="/settings/billing" className="text-[12px] text-slate-700 underline">
            Billing help
          </Link>
        </div>

        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2">
              <ExclamationTriangleIcon className="h-4 w-4 text-rose-700" />
              <div className="text-[13px] font-medium text-rose-800">Cancel subscription</div>
            </div>
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="rounded-md border border-rose-300 bg-white px-2 py-1 text-[12px] text-rose-700 hover:bg-rose-50"
            >
              Cancel now
            </button>
          </div>
          <div className="mt-1 text-[12px] text-rose-700">
            Your access will pause immediately. You can reactivate anytime from Billing.
          </div>
        </div>
      </div>

      {/* Advanced cancel flow modal */}
      <CancelFlowModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={async (payload) => {
          await confirmCancelSubscription(payload);
          setCancelOpen(false);
        }}
      />
    </div>
  );
}

/* Advanced Cancel Flow Modal stays unchanged */
function CancelFlowModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { reason: string; details?: string }) => Promise<void> | void;
}) {
  const [step, setStep] = useState<'survey' | 'confirm'>('survey');
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState<string>('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasons = [
    'Too expensive',
    'Missing features',
    'Temporary pause',
    'Switching to another tool',
    'Closing the restaurant',
    'Other',
  ];

  React.useEffect(() => {
    if (open) {
      setStep('survey');
      setReason('');
      setDetails('');
      setAck(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const proceed = () => setStep('confirm');

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason, details: details.trim() || undefined });
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#ececec] px-5 py-4">
            <div className="text-[15px] font-semibold text-slate-900">
              {step === 'survey' ? 'Before you cancel' : 'Confirm cancellation'}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 hover:bg-slate-50"
            >
              <XMarkIcon className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          {step === 'survey' ? (
            <div className="px-5 py-5">
              <div className="text-[13px] text-slate-700">
                Help us improve by sharing why you’re canceling.
              </div>

              <div className="mt-4 grid gap-2">
                {reasons.map((r) => (
                  <label key={r} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-[13px]">
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                    />
                    <span className="text-slate-800">{r}</span>
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-[12px] font-medium text-slate-700">Additional details (optional)</label>
                <textarea
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-[13px] focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="Anything we could have done better?"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-[13px] hover:bg-slate-50"
                >
                  Keep plan
                </button>
                <button
                  type="button"
                  disabled={!reason}
                  onClick={proceed}
                  className="rounded-md bg-[#2e2e30] px-4 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-5">
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                <div className="font-medium">What happens if you cancel now</div>
                <ul className="mt-2 list-disc pl-5">
                  <li>Access pauses immediately. Editors and AI features will be disabled.</li>
                  <li>Your data stays safe. You can reactivate anytime.</li>
                  <li>No further charges unless you reactivate.</li>
                </ul>
              </div>

              <div className="mt-4 text-[13px] text-slate-800">
                <div className="font-medium">Reason selected:</div>
                <div className="mt-1 text-slate-700">{reason || '—'}</div>
                {details.trim() && (
                  <>
                    <div className="mt-3 font-medium">Details:</div>
                    <div className="mt-1 whitespace-pre-wrap text-slate-700">{details}</div>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-4 rounded border border-rose-300 bg-white px-3 py-2 text-[12px] text-rose-700">
                  {error}
                </div>
              )}

              <label className="mt-5 flex items-center gap-2 text-[13px] text-slate-800">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand my access will pause immediately</span>
              </label>

              <div className="mt-5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('survey')}
                  className="rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-[13px] hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!ack || busy}
                  onClick={confirm}
                  className="rounded-md bg-rose-600 px-4 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? 'Cancelling…' : 'Cancel subscription now'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}