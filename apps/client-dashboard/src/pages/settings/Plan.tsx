import { useEffect, useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getPlan,
  updatePlan,
  type PlanState,
  type PlanTier,
} from '../../api/billing';
import { ChevronRightIcon, CheckIcon } from '@heroicons/react/24/outline';

/* Catalog for current plan summary and sheet cards */
const catalog: Record<
  PlanTier,
  {
    label: string;
    priceM: number; // USD per month
    includesSeats: number;
    features: string[];
  }
> = {
  Free: {
    label: 'Free',
    priceM: 0,
    includesSeats: 1,
    features: ['Basic menu', 'QR menu link', 'Community support'],
  },
  Starter: {
    label: 'Starter',
    priceM: 29,
    includesSeats: 3,
    features: ['Custom domain', 'Branding', 'Email support'],
  },
  Pro: {
    label: 'Pro',
    priceM: 99,
    includesSeats: 5,
    features: ['Analytics', 'Advanced roles', 'API/Webhooks'],
  },
  Business: {
    label: 'Business',
    priceM: 249,
    includesSeats: 10,
    features: ['SLA & SSO', 'Multi-venue', 'Priority support'],
  },
  Enterprise: {
    label: 'Enterprise',
    priceM: 0,
    includesSeats: 25,
    features: ['Custom SSO/SAML', 'Dedicated infra', 'Custom terms'],
  },
};

/* Two-card selector content (used in the sheet) */
type PlanCardId = 'p1' | 'p2';

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
];

const disabledInStarter = new Set([
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
]);

const idToTier: Record<PlanCardId, PlanTier> = { p1: 'Starter', p2: 'Pro' };
const tierToId: Partial<Record<PlanTier, PlanCardId>> = { Starter: 'p1', Pro: 'p2' };

export default function SettingsPlan(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PlanState | null>(null);

  // Path-driven sheet: /settings/plan/select
  const navigate = useNavigate();
  const matchSelect = useMatch('/settings/plan/select');
  const sheetOpen = Boolean(matchSelect);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { plan } = await getPlan();
      if (!mounted) return;
      setPlan(plan);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const entry = plan ? catalog[plan.tier] : null;

  const priceLine = useMemo(() => {
    if (!plan || !entry) return '';
    if (plan.tier === 'Enterprise') return 'Custom';
    const m = entry.priceM;
    if (plan.interval === 'month') return `$${m} USD/month`;
    const y = Math.round(m * 12 * 0.85); // 15% off yearly
    return `$${y} USD/year`;
  }, [plan, entry]);

  const yearlySavings = useMemo(() => {
    if (!plan || !entry || entry.priceM <= 0 || plan.tier === 'Enterprise') return 0;
    const full = entry.priceM * 12;
    const discounted = Math.round(entry.priceM * 12 * 0.85);
    return full - discounted;
  }, [plan, entry]);

  // Snapshot benefits for summary (small list only)
  const snapshotBenefits = useMemo(() => {
    if (!plan) return [];
    // For Starter, show first 3 enabled service items
    if (plan.tier === 'Starter') return services.filter((s) => !disabledInStarter.has(s)).slice(0, 3);
    // For Pro or higher, just show first 3 items for a compact snapshot
    return services.slice(0, 3);
  }, [plan]);

  const openSheet = () => navigate('/settings/plan/select');
  const closeSheet = () => navigate('/settings/plan', { replace: true });

  if (loading || !plan || !entry) {
    return (
      <div className="grid gap-4">
        <div className="h-10 animate-pulse rounded-xl border border-[#ececec] bg-white" />
        <div className="h-40 animate-pulse rounded-xl border border-[#ececec] bg-white" />
      </div>
    );
  }

  const isYearly = plan.interval === 'year';

  return (
    <div className="grid gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold text-slate-900">Plan details</div>
        <button
          onClick={openSheet}
          className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
        >
          Change plan
        </button>
      </div>

      {/* Plan details card */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <div className="text-[18px] font-semibold text-slate-900">{entry.label}</div>
          <div className="text-[20px] font-bold text-slate-900">{priceLine}</div>
          {entry.priceM > 0 && plan.tier !== 'Enterprise' && (
            <div className="text-[12px] text-slate-600">
              {isYearly ? 'Billed yearly' : 'Billed monthly'} • Includes {entry.includesSeats} seats
            </div>
          )}
        </div>

        {/* Yearly savings banner */}
        {entry.priceM > 0 && plan.tier !== 'Enterprise' && (
          <button
            type="button"
            onClick={openSheet}
            className="mt-3 inline-flex w-full items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-[13px] text-indigo-800"
            title="See billing options"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3m6 0c0 1.657-1.343 3-3 3m0 0v2m0-8V6m0 0a9 9 0 110 12 9 9 0 010-12z" />
            </svg>
            Pay yearly and save {formatCurrency(yearlySavings)}/year
          </button>
        )}

        {/* Snapshot benefits only (compact) */}
        <div className="mt-3 border-t border-slate-200 pt-3">
          <ul className="space-y-2 text-[13px] text-slate-800">
            {snapshotBenefits.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckIcon className="h-4 w-4 text-slate-600" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Tinted footer row (opens selector) */}
        <button
          type="button"
          onClick={openSheet}
          className="mt-4 -mx-4 -mb-4 flex w-[calc(100%+2rem)] items-center justify-between rounded-b-xl border-t border-[#e5e5e5] bg-[#f6f6f6] px-4 py-3 text-left text-[13px] text-slate-700 hover:bg-[#efefef]"
        >
          <span>View all features</span>
          <ChevronRightIcon className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {/* Bottom sheet modal (path-driven) */}
      <PlanSelectorSheet
        open={sheetOpen}
        onClose={closeSheet}
        current={plan}
        onUpdated={(p) => setPlan(p)}
      />
    </div>
  );
}

/* Interval switch like the screenshot ("Pay monthly | Pay yearly  Save 15%") */
function PlanIntervalSwitch({
  value,
  onChange,
  savingsLabel = 'Save 15%',
}: {
  value: 'monthly' | 'yearly';
  onChange: (v: 'monthly' | 'yearly') => void;
  savingsLabel?: string;
}) {
  const active = (v: 'monthly' | 'yearly') => value === v;
  return (
    <div className="inline-flex items-center rounded-full border border-[#e5e5e5] bg-white p-1">
      <button
        type="button"
        aria-pressed={active('monthly')}
        onClick={() => onChange('monthly')}
        className={`rounded-full px-3 py-1.5 text-[12px] transition ${
          active('monthly') ? 'bg-[#2e2e30] font-medium text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
        }`}
      >
        Pay monthly
      </button>
      <div className="ml-2 inline-flex items-center gap-2">
        <button
          type="button"
          aria-pressed={active('yearly')}
          onClick={() => onChange('yearly')}
          className={`rounded-full px-3 py-1.5 text-[12px] transition ${
            active('yearly') ? 'bg-[#2e2e30] font-medium text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          Pay yearly
        </button>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          {savingsLabel}
        </span>
      </div>
    </div>
  );
}

/* Bottom sheet with 55px top gap, rounded top edges, clipped radius */
function PlanSelectorSheet({
  open,
  onClose,
  current,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  current: PlanState;
  onUpdated: (p: PlanState) => void;
}) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loadingPlan, setLoadingPlan] = useState<PlanCardId | null>(null);

  useEffect(() => {
    if (!open) return;
    setBillingCycle(current.interval === 'year' ? 'yearly' : 'monthly');
    setLoadingPlan(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onEsc);
    };
  }, [open, current, onClose]);

  const plans = [
    { id: 'p1' as PlanCardId, title: 'Starter', monthly: '$29', yearly: '$290', description: 'Everything you need to get started with your digital restaurant menu.' },
    { id: 'p2' as PlanCardId, title: 'Pro', monthly: '$99', yearly: '$990', description: 'Unlock full potential with online ordering, integrations, and AI features.', highlight: true },
  ];

  const currentId: PlanCardId | null = tierToId[current.tier] ?? null;
  const toggleBilling = (v: 'monthly' | 'yearly') => setBillingCycle(v);

  const handleSelect = async (id: PlanCardId) => {
    const nextTier = idToTier[id];
    const nextInterval = billingCycle === 'monthly' ? 'month' : 'year';
    const same = current.tier === nextTier && current.interval === nextInterval;
    if (same) return onClose();

    setLoadingPlan(id);
    try {
      const saved = await updatePlan({ ...current, tier: nextTier, interval: nextInterval });
      onUpdated(saved);
      onClose();
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          {/* Overlay */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={onClose}
          />
          {/* Sheet: 55px gap from top; rounded top; overflow-hidden to clip corners */}
          <motion.div
            className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl overflow-hidden border border-[#e5e5e5] bg-white shadow-2xl"
            style={{ top: 55, willChange: 'transform' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ececec] bg-white px-4 py-3">
              <div className="text-[14px] font-semibold text-slate-900">Choose your plan</div>
              <div className="hidden sm:block">
                <PlanIntervalSwitch value={billingCycle} onChange={toggleBilling} savingsLabel="Save 15%" />
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50 sm:ml-3"
              >
                Close
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Switch for small screens */}
              <div className="mb-6 flex items-center justify-center sm:hidden">
                <PlanIntervalSwitch value={billingCycle} onChange={toggleBilling} savingsLabel="Save 15%" />
              </div>

              <div className="mx-auto flex max-w-6xl flex-col justify-center gap-10 lg:flex-row">
                {plans.map((card) => {
                  const isStarter = card.id === 'p1';
                  const isLoading = loadingPlan === card.id;

                  const isActiveTier = currentId === card.id;
                  const matchesInterval = (billingCycle === 'yearly') === (current.interval === 'year');

                  // Determine CTA label and style
                  let ctaLabel = 'Change plan';
                  let ctaDisabled = false;
                  let ctaClass =
                    'bg-[#f5f5f5] text-[#2e2e30] hover:bg-[#e9e9ee]';

                  if (isActiveTier) {
                    if (matchesInterval) {
                      ctaLabel = 'Selected';
                      ctaDisabled = true;
                      ctaClass = 'bg-slate-800 text-white';
                    } else {
                      ctaLabel = billingCycle === 'yearly' ? 'Switch to yearly' : 'Switch to monthly';
                      ctaClass = 'bg-[#2e2e30] text-white hover:opacity-90';
                    }
                  }

                  return (
                    <motion.div
                      key={card.id}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      className={[
                        'relative flex w-full max-w-md flex-col rounded-3xl border bg-white shadow-md transition-all',
                        'border-[#e4e4e7] hover:shadow-lg',
                        card.highlight ? 'ring-2 ring-[#2e2e30]' : '',
                      ].join(' ')}
                    >
                      {card.highlight && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#2e2e30] px-3 py-0.5 text-xs font-medium text-white shadow-sm">
                          Popular
                        </span>
                      )}
                      {isActiveTier && matchesInterval && (
                        <span className="absolute -top-3 right-4 rounded-full bg-emerald-600 px-3 py-0.5 text-xs font-medium text-white shadow-sm">
                          Selected
                        </span>
                      )}

                      <div className="flex flex-1 flex-col p-7">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-[#2e2e30]">{card.title}</h2>
                          <motion.span layout className="text-3xl font-bold text-[#2e2e30]">
                            {billingCycle === 'monthly' ? card.monthly : card.yearly}
                            <span className="ml-1 text-base font-medium">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                          </motion.span>
                        </div>
                        <p className="mb-5 text-sm text-[#555]">{card.description}</p>
                        <ul className="flex-1 space-y-3 text-sm">
                          {services.map((s) => {
                            const disabled = isStarter && disabledInStarter.has(s);
                            return (
                              <li key={s} className={`flex items-center gap-2 ${disabled ? 'text-gray-400 line-through' : 'text-[#2e2e30]'}`}>
                                {disabled ? (
                                  <svg className="h-4 w-4 text-rose-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                ) : (
                                  <svg className="h-4 w-4 text-[#2e2e30]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                                {s}
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelect(card.id)}
                        disabled={isLoading || ctaDisabled}
                        className={[
                          'flex w-full items-center justify-center gap-2 rounded-b-3xl py-4 text-base font-medium transition',
                          isLoading ? 'bg-[#2e2e2e] text-white cursor-wait' : ctaClass,
                        ].join(' ')}
                      >
                        {isLoading ? (
                          <>
                            <svg className="h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                            </svg>
                            Applying…
                          </>
                        ) : (
                          ctaLabel
                        )}
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* Helpers */
function formatCurrency(amount: number, currency = 'usd'): string {
  const code = currency.toUpperCase();
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
}