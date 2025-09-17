// apps/client-dashboard/src/features/billing/pages/PlanSheet.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { usePlanQuery, useUpdatePlanMutation, useSubscribePlanMutation } from '../hooks/usePlan';
import { PlanIntervalSwitch } from '../components/PlanIntervalSwitch';
import type { PlanState, PlanTier } from '../../../api/billing';
import { useTenant } from '../../../hooks/useTenant';

type PlanCardId = 'p1' | 'p2';
const idToTier: Record<PlanCardId, Extract<PlanTier, 'Starter' | 'Pro'>> = { p1: 'Starter', p2: 'Pro' };

// Steps
type SheetStep = 'select' | 'subscribe' | 'success';

type SubscribeResult = {
  name: string;
  brand?: string;
  last4?: string;
  interval: 'month' | 'year';
  amountCents: number;
  currency: string;
};

type CardBrand =
  | 'visa' | 'visa_electron' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'maestro' | 'unionpay' | 'unknown';

const SERVICES = [
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
const DISABLED_IN_STARTER = new Set([
  'Online Ordering & Payments',
  'Third-Party Delivery Integration',
  'Built-in Marketing Tools',
]);

export default function PlanSheet(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = (params.get('step') as SheetStep) || 'select';

  const { data: plan, isLoading } = usePlanQuery();
  const { mutateAsync: savePlan } = useUpdatePlanMutation();
  const { mutateAsync: subscribePlan } = useSubscribePlanMutation();

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loadingPlan, setLoadingPlan] = useState<PlanCardId | null>(null);
  const [subscribeResult, setSubscribeResult] = useState<SubscribeResult | null>(null);

  // lock scroll + Esc close while sheet mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/settings/plan', { replace: true });
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onEsc);
    };
  }, [navigate]);

  useEffect(() => {
    if (plan) setBillingCycle(plan.interval === 'year' ? 'yearly' : 'monthly');
  }, [plan]);

  const close = () => navigate('/settings/plan', { replace: true });

  // Select -> Subscribe
  const onSelectPlan = async (id: PlanCardId) => {
    if (!plan) return;
    const nextTier: PlanTier = idToTier[id];
    const nextInterval: PlanState['interval'] = billingCycle === 'monthly' ? 'month' : 'year';
    const isSame = plan.tier === nextTier && plan.interval === nextInterval;

    if (!isSame) {
      setLoadingPlan(id);
      try {
        const updated: PlanState = { ...plan, tier: nextTier, interval: nextInterval };
        await savePlan(updated);
      } finally {
        setLoadingPlan(null);
      }
    }
    params.set('step', 'subscribe');
    setParams(params, { replace: true });
  };

  // Subscribe handlers
  const goBack = () => {
    params.set('step', 'select');
    setParams(params, { replace: true });
  };

  type OnSubscribePayload = {
    name: string;
    cardToken: string;
    planId: string;
    interval: 'month' | 'year';
    amountCents: number;
    currency: string;
    brand?: CardBrand;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  };

  const proceed = async (payload: OnSubscribePayload) => {
    try {
      await subscribePlan({
        planId: payload.planId,
        interval: payload.interval,
        cardToken: payload.cardToken,
        name: payload.name,
        amountCents: payload.amountCents,
        currency: payload.currency,
        payment: {
          provider: 'mock',
          brand: payload.brand === 'visa_electron' ? 'visa' : (payload.brand as any) ?? 'unknown',
          last4: payload.last4,
          expMonth: payload.expMonth,
          expYear: payload.expYear,
        },
      });

      setSubscribeResult({
        name: payload.name,
        brand: payload.brand === 'visa_electron' ? 'visa' : (payload.brand as string | undefined),
        last4: payload.last4,
        interval: payload.interval,
        amountCents: payload.amountCents,
        currency: payload.currency,
      });

      params.set('step', 'success');
      setParams(params, { replace: true });
    } catch (e) {
      console.error('Subscribe failed', e);
    }
  };

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Overlay */}
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={close}
      />

      {/* Sheet container */}
      <motion.div
        className="absolute inset-x-0 bottom-0 flex min-h-[calc(100vh-55px)] flex-col overflow-hidden rounded-t-2xl border border-[#e5e5e5] bg-white shadow-2xl"
        style={{ top: 55, willChange: 'transform' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ececec] bg-white px-4 py-3">
          <div className="text-[14px] font-semibold text-slate-900">
            {step === 'select' ? 'Choose your plan' : step === 'subscribe' ? 'Subscribe' : 'Welcome aboard'}
          </div>
          <div className="flex items-center gap-2">
            {step === 'subscribe' && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading || !plan ? (
            <div className="text-sm text-slate-600">Loading plan…</div>
          ) : step === 'select' ? (
            <SelectStep
              billingCycle={billingCycle}
              setBillingCycle={setBillingCycle}
              loadingPlan={loadingPlan}
              onSelect={onSelectPlan}
            />
          ) : step === 'subscribe' ? (
            <SubscribeCheckout plan={plan} onSubscribe={proceed} />
          ) : (
            <SuccessStep
              plan={plan}
              result={subscribeResult}
              onDone={() => navigate('/dashboard', { replace: true })}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* Select step (unchanged) */
function SelectStep({
  billingCycle,
  setBillingCycle,
  loadingPlan,
  onSelect,
}: {
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (v: 'monthly' | 'yearly') => void;
  loadingPlan: PlanCardId | null;
  onSelect: (id: PlanCardId) => void;
}) {
  const plans: Array<{
    id: PlanCardId;
    title: 'Starter' | 'Pro';
    monthly: string;
    yearly: string;
    description: string;
    highlight?: boolean;
  }> = [
    { id: 'p1', title: 'Starter', monthly: '$29', yearly: '$290', description: 'Everything you need to get started with your digital restaurant menu.' },
    { id: 'p2', title: 'Pro', monthly: '$99', yearly: '$990', description: 'Unlock full potential with online ordering, integrations, and AI features.', highlight: true },
  ];

  return (
    <>
      <div className="mb-6 flex items-center justify-center">
        <PlanIntervalSwitch value={billingCycle} onChange={setBillingCycle} />
      </div>

      <div className="mx-auto flex max-w-6xl flex-col justify-center gap-10 lg:flex-row">
        {plans.map((card) => {
          const isStarter = card.id === 'p1';
          const isSaving = loadingPlan === card.id;

          return (
            <div
              key={card.id}
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

              <div className="flex flex-1 flex-col p-7">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-[#2e2e30]">{card.title}</h2>
                  <span className="text-3xl font-bold text-[#2e2e30]">
                    {billingCycle === 'monthly' ? card.monthly : card.yearly}
                    <span className="ml-1 text-base font-medium">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                  </span>
                </div>
                <p className="mb-5 text-sm text-[#555]">{card.description}</p>

                <ul className="flex-1 space-y-3 text-sm">
                  {SERVICES.map((s) => {
                    const disabled = isStarter && DISABLED_IN_STARTER.has(s);
                    return (
                      <li
                        key={s}
                        className={`flex items-center gap-2 ${disabled ? 'text-gray-400 line-through' : 'text-[#2e2e30]'}`}
                      >
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
                onClick={() => onSelect(card.id)}
                disabled={isSaving}
                className={[
                  'flex w-full items-center justify-center gap-2 rounded-b-3xl py-4 text-base font-medium transition',
                  isSaving ? 'bg-[#2e2e2e] text-white cursor-wait' : 'bg-[#2e2e30] text-white hover:opacity-90',
                ].join(' ')}
              >
                {isSaving ? (
                  <>
                    <svg className="h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Selecting…
                  </>
                ) : (
                  'Select'
                )}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* Subscribe checkout — industry-grade saved-card flow + minimal card form */
function SubscribeCheckout({
  plan,
  onSubscribe,
}: {
  plan: PlanState;
  onSubscribe: (payload: {
    name: string;
    cardToken: string;
    planId: string;
    interval: 'month' | 'year';
    amountCents: number;
    currency: string;
    brand?: CardBrand;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  }) => Promise<void> | void;
}) {
  const { data: tenant, isLoading: tenantLoading } = useTenant();

  // Interval from selected plan (no toggle here)
  const [localInterval, setLocalInterval] = useState<'month' | 'year'>(plan.interval);
  useEffect(() => setLocalInterval(plan.interval), [plan.interval]);

  // Pricing
  const priceCentsMonthly = plan.tier === 'Starter' ? 2900 : plan.tier === 'Pro' ? 9900 : 0;
  const yearlyDiscountRate = 0.15;
  const rawYearCents = priceCentsMonthly * 12;
  const discountCentsYear = Math.round(rawYearCents * yearlyDiscountRate);
  const effectiveYearCents = rawYearCents - discountCentsYear;
  const planPriceCents = localInterval === 'year' ? effectiveYearCents : priceCentsMonthly;

  const planId = (() => {
    const base = plan.tier === 'Starter' ? 'p1' : plan.tier === 'Pro' ? 'p2' : 'p0';
    const suff = localInterval === 'year' ? 'y' : 'm';
    return `${base}_${suff}`;
  })();

  const fmt = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

  // Saved card from backend
  const saved = !tenantLoading && !!tenant?.hasCardOnFile && !!tenant?.payment?.last4;
  const savedPM = tenant?.payment ?? undefined;

  // Toggle: saved card or new card form
  const [useSavedCard, setUseSavedCard] = useState<boolean>(saved);
  useEffect(() => setUseSavedCard(saved), [saved]);

  // Brand helpers
  const brandIconMap: Record<CardBrand, string | null> = {
    visa: '/brands/visa.svg',
    visa_electron: '/brands/visa-electron.svg',
    amex: '/brands/american-express.svg',
    mastercard: '/brands/mastercard.svg',
    discover: '/brands/discover.svg',
    jcb: '/brands/jcb.svg',
    maestro: '/brands/maestro.svg',
    diners: '/brands/cb.svg',
    unionpay: null,
    unknown: null,
  };
  const brandLabel = (b?: string) => {
    const v = (b || 'unknown').toLowerCase();
    if (v === 'amex') return 'American Express';
    if (v === 'diners') return 'Diners Club';
    if (v === 'visa_electron') return 'Visa';
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
  const pad2 = (n?: number) => {
    const v = Number(n || 0);
    return v < 10 ? `0${v}` : String(v);
  };

  // Form state for "use different card"
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<CardBrand>('unknown');

  const cvcMaxLen = brand === 'amex' ? 4 : 3;
  const cvcPlaceholder = brand === 'amex' ? '••••' : '•••';

  // Focus style: only black border on focus
  const field =
    'h-12 w-full rounded-lg border border-slate-300 px-3.5 text-[15px] placeholder:text-slate-500 focus:outline-none focus:border-black';

  // Card helpers
  function detectBrand(d: string): CardBrand {
    if (/^(4026|417500|4508|4844|4913|4917)/.test(d)) return 'visa_electron';
    if (/^4\d{0,}$/.test(d)) return 'visa';
    if (/^(5[1-5]|2(2[2-9]\d|[3-6]\d{2}|7[01]\d|720))\d{0,}$/.test(d)) return 'mastercard';
    if (/^3[47]\d{0,}$/.test(d)) return 'amex';
    if (/^6(?:011|5|4[4-9])\d{0,}$/.test(d)) return 'discover';
    if (/^3(?:0[0-5]|[68]\d)\d{0,}$/.test(d)) return 'diners';
    if (/^(?:2131|1800|35)\d{0,}$/.test(d)) return 'jcb';
    if (/^(50|5[6-9]|6)\d{0,}$/.test(d)) return 'maestro';
    if (/^62\d{0,}$/.test(d)) return 'unionpay';
    return 'unknown';
  }
  function luhnCheck(num: string) {
    let sum = 0, dbl = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = parseInt(num[i], 10);
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function formatCardNumber(d: string, b: CardBrand): string {
    if (b === 'amex') return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    return d.match(/.{1,4}/g)?.join(' ') ?? d;
  }
  function boundariesForBrand(b: CardBrand) { return b === 'amex' ? [4, 10] : [4, 8, 12, 16]; }
  function formatCardNumberAndCaret(all: string, b: CardBrand, before: number) {
    const formatted = formatCardNumber(all, b);
    const spacesBefore = boundariesForBrand(b).filter((n) => before >= n).length;
    const caret = Math.min(formatted.length, before + spacesBefore);
    return { formatted, caret };
  }
  function handleCardInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const prev = el.selectionStart ?? el.value.length;
    const beforeDigits = el.value.slice(0, prev).replace(/\D/g, '').slice(0, 19);
    const allDigits = el.value.replace(/\D/g, '').slice(0, 19);
    const b = detectBrand(allDigits);
    setBrand(b);
    const { formatted, caret } = formatCardNumberAndCaret(allDigits, b, beforeDigits.length);
    el.value = formatted;
    requestAnimationFrame(() => { try { el.setSelectionRange(caret, caret); } catch {} });
  }
  function formatExpiry(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) return '';
    if (digits.length < 2) return digits;
    if (digits.length === 2) return `${digits}/`;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  function handleExpInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const prev = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, prev).replace(/\D/g, '').slice(0, 4);
    const formatted = formatExpiry(el.value);
    el.value = formatted;
    const newPos = before.length < 2 ? before.length : before.length === 2 ? 3 : before.length + 1;
    requestAnimationFrame(() => { try { el.setSelectionRange(newPos, newPos); } catch {} });
  }
  function handleExpKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget; const pos = el.selectionStart ?? 0; const end = el.selectionEnd ?? pos; const sel = end > pos;
    if (e.key === 'Backspace' && !sel && pos === 3) {
      e.preventDefault();
      const digits = el.value.replace(/\D/g, ''); if (digits.length >= 2) {
        el.value = formatExpiry(digits[0] + digits.slice(2));
        requestAnimationFrame(() => { try { el.setSelectionRange(2, 2); } catch {} });
      } return;
    }
    if (e.key === 'Delete' && !sel && pos === 2) {
      e.preventDefault();
      const digits = el.value.replace(/\D/g, '');
      if (digits.length > 2) el.value = formatExpiry(digits.slice(0, 2) + digits.slice(3));
      requestAnimationFrame(() => { try { el.setSelectionRange(3, 3); } catch {} }); return;
    }
    if (e.key === '/') e.preventDefault();
  }
  function handleDigitsOnly(maxLen?: number) {
    return (e: React.FormEvent<HTMLInputElement>) => {
      const el = e.currentTarget; const digits = el.value.replace(/\D/g, '');
      el.value = maxLen ? digits.slice(0, maxLen) : digits;
    };
  }

  // Submit handler (uses saved card or validates new card)
  function validate(fd: FormData) {
    const name = String(fd.get('name') || '').trim();
    const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
    const exp = String(fd.get('exp') || '').trim();
    const cvc = String(fd.get('cvc') || '').trim();
    const country = String(fd.get('country') || '').trim();
    const zip = String(fd.get('zip') || '').trim();
    const newErrors: Record<string, string> = {};
    if (!name) newErrors.name = 'Name is required';
    if (brand === 'amex') { if (cardDigits.length !== 15 || !luhnCheck(cardDigits)) newErrors.card = 'Enter a valid Amex number'; }
    else if (cardDigits.length < 13 || cardDigits.length > 19 || !luhnCheck(cardDigits)) newErrors.card = 'Enter a valid card number';
    if (!/^\d{2}\/\d{2}$/.test(exp)) newErrors.exp = 'Use MM/YY format';
    else { const mm = Number(exp.split('/')[0]); if (mm < 1 || mm > 12) newErrors.exp = 'Invalid month'; }
    const expectedCvcLen = brand === 'amex' ? 4 : 3;
    if (!/^\d+$/.test(cvc) || cvc.length !== expectedCvcLen) newErrors.cvc = `Enter a ${expectedCvcLen}-digit CVC`;
    if (!country) newErrors.country = 'Country is required';
    if (!zip) newErrors.zip = 'ZIP/Postal is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    // Using saved card: no field validation, just proceed
    if (useSavedCard && savedPM?.last4) {
      setSubmitting(true);
      try {
        await Promise.resolve(
          onSubscribe({
            name: 'Card on file',
            cardToken: 'pm_onfile',
            planId,
            interval: localInterval,
            amountCents: planPriceCents,
            currency: 'USD',
            brand: (savedPM.brand as CardBrand) ?? 'unknown',
            last4: savedPM.last4,
            expMonth: savedPM.expMonth,
            expYear: savedPM.expYear,
          })
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // New card path
    const fd = new FormData(e.currentTarget);
    if (!validate(fd)) return;

    setSubmitting(true);
    try {
      const name = String(fd.get('name') || '').trim();
      const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
      const expStr = String(fd.get('exp') || '');
      const [mmStr, yyStr] = expStr.split('/');
      const expMonth = Number(mmStr);
      const expYear = 2000 + Number(yyStr);
      const fakeToken = 'tok_' + Math.random().toString(36).slice(2, 10);

      await Promise.resolve(
        onSubscribe({
          name,
          cardToken: fakeToken,
          planId,
          interval: localInterval,
          amountCents: planPriceCents,
          currency: 'USD',
          brand,
          last4: cardDigits.slice(-4),
          expMonth,
          expYear,
        })
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Allow switching back to plan selection from Summary
  const [params, setParams] = useSearchParams();
  const goToSelect = () => {
    params.set('step', 'select');
    setParams(params, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-2 md:px-4">
      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-12">
        {/* Left: Saved card or Payment form */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-200/60">
            <div className="text-base font-semibold text-slate-900">Payment method</div>

            {tenantLoading ? (
              <div className="mt-5 h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ) : useSavedCard && savedPM?.last4 ? (
              <div className="mt-5 grid gap-4">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    {brandIconMap[(savedPM.brand as CardBrand) ?? 'unknown'] && (
                      <img
                        src={brandIconMap[(savedPM.brand as CardBrand) ?? 'unknown']!}
                        alt=""
                        aria-hidden="true"
                        className="h-5 w-auto"
                        draggable={false}
                      />
                    )}
                    <span className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                      {brandLabel(savedPM.brand).toUpperCase()}
                    </span>
                    <div className="text-[13px] text-slate-800">
                      •••• {savedPM.last4}{' '}
                      {savedPM.expMonth && savedPM.expYear ? (
                        <span className="text-slate-500">(Exp {pad2(savedPM.expMonth)}/{String(savedPM.expYear).slice(-2)})</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseSavedCard(false)}
                    className="rounded-md border border-[#e2e2e2] bg-white px-2.5 py-1.5 text-[12px] hover:bg-slate-50"
                  >
                    Use a different card
                  </button>
                </div>

                <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
                  <ShieldCheckIcon className="h-4 w-4 text-slate-500" />
                  <span>Your saved card will be charged securely.</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                <div className="grid gap-1.5">
                  <label className="text-[13px] font-medium text-slate-700">Name on card</label>
                  <input name="name" className={field} placeholder="Jane Doe" autoComplete="cc-name" />
                  {errors.name && <div className="text-[12px] text-rose-600">{errors.name}</div>}
                </div>

                <div className="grid gap-1.5">
                  <label className="text-[13px] font-medium text-slate-700">Card number</label>
                  <div className="relative">
                    <input
                      name="card"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      className={`${field} pr-14`}
                      placeholder="4242 4242 4242 4242"
                      onInput={handleCardInput}
                    />
                    {brandIconMap[brand] && (
                      <img
                        src={brandIconMap[brand]!}
                        alt=""
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3 top-1/2 h-6 w-auto -translate-y-1/2 select-none"
                        loading="eager"
                        draggable={false}
                      />
                    )}
                  </div>
                  {errors.card && <div className="text-[12px] text-rose-600">{errors.card}</div>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label className="text-[13px] font-medium text-slate-700">Expiry</label>
                    <input
                      name="exp"
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      className={field}
                      placeholder="MM/YY"
                      maxLength={5}
                      onInput={handleExpInput}
                      onKeyDown={handleExpKeyDown}
                    />
                    {errors.exp && <div className="text-[12px] text-rose-600">{errors.exp}</div>}
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[13px] font-medium text-slate-700">CVC</label>
                    <input
                      type="password"
                      name="cvc"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      className={field}
                      placeholder={cvcPlaceholder}
                      maxLength={cvcMaxLen}
                      onInput={handleDigitsOnly(cvcMaxLen)}
                    />
                    {errors.cvc && <div className="text-[12px] text-rose-600">{errors.cvc}</div>}
                  </div>
                </div>

                {/* Address full width */}
                <div className="grid gap-1.5">
                  <label className="text-[13px] font-medium text-slate-700">Address</label>
                  <input name="address" className={field} placeholder="123 Market St" autoComplete="address-line1" />
                </div>

                {/* ZIP/Postal then Country */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label className="text-[13px] font-medium text-slate-700">ZIP / Postal</label>
                    <input name="zip" className={field} placeholder="94105" autoComplete="postal-code" />
                    {errors.zip && <div className="text-[12px] text-rose-600">{errors.zip}</div>}
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[13px] font-medium text-slate-700">Country</label>
                    <input name="country" className={field} placeholder="United States" autoComplete="country-name" />
                    {errors.country && <div className="text-[12px] text-rose-600">{errors.country}</div>}
                  </div>
                </div>

                <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
                  <ShieldCheckIcon className="h-4 w-4 text-slate-500" />
                  <span>Payments are encrypted and processed securely.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Summary */}
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-200/60">
            <div className="text-base font-semibold text-slate-900">Summary</div>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
                <div className="flex items-center justify-between text-[14px]">
                  <div className="font-semibold text-slate-900">{plan.tier}</div>
                  <div className="text-slate-800">
                    {fmt(localInterval === 'year' ? rawYearCents : priceCentsMonthly)}
                  </div>
                </div>
                <div className="mt-0.5 text-[12px] text-slate-600">
                  Billed {localInterval === 'year' ? 'yearly' : 'monthly'}
                </div>
                <div className="mt-2 text-[12px]">
                  <button
                    type="button"
                    onClick={goToSelect}
                    className="text-slate-700 underline underline-offset-2 hover:text-slate-900"
                  >
                    Change plan
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full table-fixed text-left text-[14px]">
                  <colgroup>
                    <col className="w-[70%]" />
                    <col className="w-[30%]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-3 py-2 truncate">
                        {plan.tier} ({localInterval === 'year' ? 'Yearly' : 'Monthly'})
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmt(localInterval === 'year' ? effectiveYearCents : priceCentsMonthly)}
                      </td>
                    </tr>
                    {localInterval === 'year' && (
                      <tr>
                        <td className="px-3 py-2 text-emerald-700">Yearly discount (15%)</td>
                        <td className="px-3 py-2 text-right text-emerald-700">- {fmt(discountCentsYear)}</td>
                      </tr>
                    )}
                    <tr className="bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-900">Total</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(planPriceCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-3 inline-flex w-full items-center justify-between rounded-lg bg-[#2e2e30] px-4 py-3 text-[15px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                <span>{submitting ? 'Processing…' : 'Subscribe'}</span>
                <span className="opacity-90">
                  {fmt(planPriceCents)} {localInterval === 'year' ? '/yr' : '/mo'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function SuccessStep({
  plan,
  result,
  onDone,
}: {
  plan: PlanState;
  result: SubscribeResult | null;
  onDone: () => void;
}) {
  // Simple price calc for fallback
  const priceCentsMonthly = plan.tier === 'Starter' ? 2900 : plan.tier === 'Pro' ? 9900 : 0;
  const yearlyDiscountRate = 0.15;
  const rawYearCents = priceCentsMonthly * 12;
  const discountCentsYear = Math.round(rawYearCents * yearlyDiscountRate);
  const effectiveYearCents = rawYearCents - discountCentsYear;

  const interval = result?.interval ?? plan.interval;
  const totalCents =
    result?.amountCents ??
    (interval === 'year' ? effectiveYearCents : priceCentsMonthly);
  const currency = result?.currency ?? 'USD';

  const totalFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(totalCents / 100);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: confetti } = await import('canvas-confetti');
        if (cancelled) return;
        confetti({ particleCount: 140, startVelocity: 38, spread: 70, origin: { y: 0.4 }, ticks: 180 });
        setTimeout(() => confetti({ particleCount: 90, angle: 60, spread: 55, origin: { x: 0 } }), 150);
        setTimeout(() => confetti({ particleCount: 90, angle: 120, spread: 55, origin: { x: 1 } }), 250);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(30,30,30,0.08),rgba(0,0,0,0))]" />
        <div className="relative p-8 md:p-10">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <SparklesIcon className="h-6 w-6 text-slate-900" />
              <div className="text-xl font-semibold text-slate-900">You’re all set</div>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="relative"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-slate-700 shadow-lg ring-1 ring-black/10">
                <CheckCircleIcon className="h-12 w-12 text-white" />
              </div>
            </motion.div>

            <div className="mt-6 text-center">
              <div className="text-2xl font-semibold text-slate-900">Welcome to {plan.tier}</div>
              <p className="mt-2 text-sm text-slate-600">
                Subscription confirmed{result?.last4 ? ` • Card ending ${result.last4}` : ''}.
              </p>
            </div>

            {/* Summary card */}
            <div className="mt-8 w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between text-[14px]">
                <div className="font-medium text-slate-900">{plan.tier}</div>
                <div className="font-semibold text-slate-900">
                  {totalFormatted}{(result?.interval ?? plan.interval) === 'year' ? '/yr' : '/mo'}
                </div>
              </div>
              <div className="mt-1 text-[12px] text-slate-600">
                Billed {(result?.interval ?? plan.interval) === 'year' ? 'yearly' : 'monthly'}
              </div>
            </div>

            {/* Buttons only */}
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onDone}
                className="inline-flex w-full items-center justify-center rounded-lg bg-[#2e2e30] px-4 py-3 text-[15px] font-medium text-white hover:opacity-90"
              >
                Continue to dashboard
              </button>
              <a
                href="/settings/plan"
                className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3 text-[15px] font-medium text-slate-900 hover:bg-slate-50"
              >
                Manage subscription
              </a>
            </div>

            <div className="mt-3 text-[12px] text-slate-500">
              We’ve emailed your receipt{result?.name ? ` to ${result.name}` : ''}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}