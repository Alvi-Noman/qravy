// apps/client-dashboard/src/components/billing/PaywallModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, LockClosedIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, SparklesIcon } from '@heroicons/react/24/solid';

type Interval = 'month' | 'year';
type Currency = 'usd' | 'eur' | 'gbp' | string;

export type PlanInfo = {
  id: string;
  name: string;
  interval: Interval;
  priceCents: number;
  currency?: Currency;
};

export type LineItem = {
  id: string;
  label: string;
  amountCents: number;
};

type BillingAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type BillingPayload = {
  companyName: string;
  billingEmail: string;
  address: BillingAddress;
};

type Props = {
  open: boolean;

  plan?: PlanInfo;
  lineItems?: LineItem[];
  discountCents?: number;
  taxRate?: number;

  onSubscribe: (payload: {
    name: string;
    cardToken: string;
    planId: string;
    billing?: BillingPayload;
  }) => Promise<void> | void;

  managePlanHref?: string;
  allowClose?: boolean;
  onClose?: () => void;
  testMode?: boolean;

  // Reactivation support
  variant?: 'trial' | 'reactivate';
  endedAt?: string;
  hasCardOnFile?: boolean;
};

type CardBrand =
  | 'visa'
  | 'visa_electron'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'maestro'
  | 'unionpay'
  | 'unknown';

export default function PaywallModal({
  open,
  plan,
  lineItems = [],
  discountCents = 0,
  taxRate = 0,
  onSubscribe,
  managePlanHref = '/settings/plan/select',
  allowClose = false,
  onClose,
  testMode = false,
  variant,
  endedAt,
  hasCardOnFile = false,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<CardBrand>('unknown');
  const [step, setStep] = useState<'checkout' | 'success'>('checkout');
  const [result, setResult] = useState<{ name: string; last4?: string } | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  // Auto-detect variant if not explicitly passed
  const derivedVariant: 'trial' | 'reactivate' = useMemo(() => {
    if (variant === 'reactivate' || variant === 'trial') return variant;
    if (hasCardOnFile) return 'reactivate';
    if (endedAt) {
      const ts = new Date(endedAt).getTime();
      if (!Number.isNaN(ts) && ts <= Date.now()) return 'reactivate';
    }
    return 'trial';
  }, [variant, hasCardOnFile, endedAt]);

  const planSafe: PlanInfo = plan ?? {
    id: 'unknown',
    name: 'Pro',
    interval: 'month',
    priceCents: 7900,
    currency: 'usd',
  };

  const currency = (planSafe.currency ?? 'usd').toUpperCase();
  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

  const subtotalCents = useMemo(() => {
    const extras = lineItems.reduce((acc, it) => acc + (it.amountCents || 0), 0);
    return (planSafe.priceCents || 0) + extras;
  }, [planSafe.priceCents, lineItems]);

  const taxedBase = Math.max(0, subtotalCents - (discountCents || 0));
  const taxCents = Math.round(taxedBase * (taxRate || 0));
  const totalCents = taxedBase + taxCents;

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

  // ---------- Card helpers ----------
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

  // ---------- Modal effects ----------
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (allowClose) onClose?.();
      }
      if (e.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!nodes || nodes.length === 0) return;
        const focusables = Array.from(nodes);
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey && active === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      lastActiveRef.current?.focus();
    };
  }, [open, allowClose, onClose]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setStep('checkout');
      setResult(null);
      setErrors({});
      setSubmitting(false);
    }
  }, [open]);

  // Confetti on success
  useEffect(() => {
    if (step !== 'success') return;
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
  }, [step]);

  // Validators
  const field =
    'h-11 w-full rounded-md border border-slate-300 px-3 text-[14px] placeholder:text-slate-500 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200';

  function validate(fd: FormData) {
    const name = String(fd.get('name') || '').trim();
    const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
    const exp = String(fd.get('exp') || '').trim();
    const cvc = String(fd.get('cvc') || '').trim();
    const country = String(fd.get('country') || '').trim();
    const zip = String(fd.get('zip') || '').trim();

    const newErrors: Record<string, string> = {};
    if (!name) newErrors.name = 'Name is required';
    if (brand === 'amex') {
      if (cardDigits.length !== 15) newErrors.card = 'Enter a valid Amex number';
    } else if (cardDigits.length < 13 || cardDigits.length > 19) {
      newErrors.card = 'Enter a valid card number';
    }
    if (!/^\d{2}\/\d{2}$/.test(exp)) {
      newErrors.exp = 'Use MM/YY format';
    } else {
      const [mmStr] = exp.split('/');
      const mm = Number(mmStr);
      if (mm < 1 || mm > 12) newErrors.exp = 'Invalid month';
    }
    const expectedCvcLen = brand === 'amex' ? 4 : 3;
    if (!/^\d+$/.test(cvc) || cvc.length !== expectedCvcLen) newErrors.cvc = `Enter a ${expectedCvcLen}-digit CVC`;
    if (!zip) newErrors.zip = 'ZIP/Postal is required';
    if (!country) newErrors.country = 'Country is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // Submit handlers
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    // Reactivate-with-card-on-file path stays the same
    const isReactivate = derivedVariant === 'reactivate';
    if (isReactivate && hasCardOnFile) {
      setSubmitting(true);
      try {
        await Promise.resolve(
          onSubscribe({ name: 'Card on file', cardToken: 'pm_onfile', planId: planSafe.id })
        );
        setResult({ name: 'Card on file' });
        setStep('success');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Trial/new subscribe or reactivate without card — require payment details
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
          planId: planSafe.id,
        })
      );

      setResult({ name, last4: cardDigits.slice(-4) });
      setStep('success');
    } finally {
      setSubmitting(false);
    }
  };

  const isReactivate = derivedVariant === 'reactivate';
  const endedOn = endedAt ? (() => { try { return new Date(endedAt).toLocaleDateString(); } catch { return endedAt; } })() : null;
  const checkoutTitle = isReactivate ? 'Access paused — reactivate to continue' : 'Your trial period has ended';
  const checkoutSub = isReactivate
    ? `Your plan ended on ${endedOn ?? '—'}. Your data is safe, but you can’t create or edit until you reactivate.`
    : 'To continue using your account, add your payment method. Your menu will remain offline until you subscribe.';
  const successTitle = isReactivate ? 'Subscription reactivated' : 'You’re all set';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm"
          aria-modal="true"
          role="dialog"
          aria-label="Checkout"
          onMouseDown={() => allowClose && onClose?.()}
        >
          <div className="grid h-full place-items-center p-3 sm:p-4" onMouseDown={(e) => e.stopPropagation()}>
            {/* Panel */}
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 18, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.99 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="relative w-full max-w-[880px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
              style={{ willChange: 'transform' }}
            >
              {/* Header */}
              <div className="flex items-start justify-between bg-[#111827] px-5 py-4 text-white">
                <div>
                  {step === 'checkout' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <LockClosedIcon className="h-5 w-5 text-white" />
                        <h2 className="text-[16px] sm:text-[18px] font-semibold">{checkoutTitle}</h2>
                      </div>
                      <p className="mt-1 text-[12px] sm:text-[13px] opacity-95">{checkoutSub}</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <SparklesIcon className="h-5 w-5 text-white" />
                        <h2 className="text-[16px] sm:text-[18px] font-semibold">{successTitle}</h2>
                      </div>
                      <p className="mt-1 text-[12px] sm:text-[13px] opacity-95">
                        Subscription confirmed{result?.last4 ? ` • Card ending ${result.last4}` : ''}.
                      </p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {testMode && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/30">
                      Test mode
                    </span>
                  )}
                  {allowClose && (
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 hover:bg-white/10">
                      <XMarkIcon className="h-5 w-5 text-white" />
                    </button>
                  )}
                </div>
              </div>

              {/* Body */}
              {step === 'checkout' ? (
                // Reactivate with saved card — simple summary path
                isReactivate && hasCardOnFile ? (
                  <div className="px-4 py-5 sm:px-6 sm:py-6">
                    <div className="mx-auto w-full max-w-[640px] rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
                      <div className="text-[15px] font-semibold text-slate-900">Summary</div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between text-[14px]">
                          <div className="font-semibold text-slate-900">{planSafe.name}</div>
                          <div className="text-slate-800">{fmt(planSafe.priceCents)}</div>
                        </div>
                        <div className="mt-0.5 text-[12px] text-slate-600">
                          Billed {planSafe.interval === 'year' ? 'yearly' : 'monthly'}
                        </div>
                        <div className="mt-2 text-[12px]">
                          <a href={managePlanHref} className="text-slate-700 underline">
                            Change plan
                          </a>
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
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
                                {planSafe.name} ({planSafe.interval === 'year' ? 'Yearly' : 'Monthly'})
                              </td>
                              <td className="px-3 py-2 text-right">{fmt(planSafe.priceCents)}</td>
                            </tr>
                            {lineItems.map((li) => (
                              <tr key={li.id}>
                                <td className="px-3 py-2 truncate">{li.label}</td>
                                <td className="px-3 py-2 text-right">{fmt(li.amountCents)}</td>
                              </tr>
                            ))}
                            <tr className="bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-900">Total</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(totalCents)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={async () => {
                          if (submitting) return;
                          setSubmitting(true);
                          try {
                            await Promise.resolve(onSubscribe({ name: 'Card on file', cardToken: 'pm_onfile', planId: planSafe.id }));
                            setResult({ name: 'Card on file' });
                            setStep('success');
                          } finally {
                            setSubmitting(false);
                          }
                        }}
                        className="mt-4 inline-flex w-full items-center justify-between rounded-lg bg-[#2e2e30] px-4 py-3 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                      >
                        <span>Reactivate subscription</span>
                        <span className="opacity-90">
                          {fmt(totalCents)} {planSafe.interval === 'year' ? '/yr' : '/mo'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  // Trial/new subscribe OR reactivate w/o card — two-column: Payment details + Summary
                  <form className="px-4 py-5 sm:px-6 sm:py-6" onSubmit={handleSubmit}>
                    <div className="mx-auto grid w-full max-w-[860px] gap-6 lg:grid-cols-12">
                      {/* Left: Payment details */}
                      <div className="lg:col-span-7">
                        <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
                          <div className="text-[15px] font-semibold text-slate-900">Payment details</div>

                          <div className="mt-4 grid gap-4">
                            <div className="grid gap-1.5">
                              <label className="text-[12px] font-medium text-slate-700">Name on card</label>
                              <input name="name" className={field} placeholder="Jane Doe" autoComplete="cc-name" />
                              {errors.name && <div className="text-[12px] text-rose-600">{errors.name}</div>}
                            </div>

                            <div className="grid gap-1.5">
                              <label className="text-[12px] font-medium text-slate-700">Card number</label>
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
                                <label className="text-[12px] font-medium text-slate-700">Expiry</label>
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
                                <label className="text-[12px] font-medium text-slate-700">CVC</label>
                                <input
                                  type="password"
                                  name="cvc"
                                  inputMode="numeric"
                                  autoComplete="cc-csc"
                                  className={field}
                                  placeholder={brand === 'amex' ? '••••' : '•••'}
                                  maxLength={brand === 'amex' ? 4 : 3}
                                  onInput={handleDigitsOnly(brand === 'amex' ? 4 : 3)}
                                />
                                {errors.cvc && <div className="text-[12px] text-rose-600">{errors.cvc}</div>}
                              </div>
                            </div>

                            {/* Address full width */}
                            <div className="grid gap-1.5">
                              <label className="text-[12px] font-medium text-slate-700">Address</label>
                              <input
                                name="address"
                                className={field}
                                placeholder="123 Market St"
                                autoComplete="address-line1"
                              />
                            </div>

                            {/* Next row: ZIP/Postal + Country */}
                            <div className="grid grid-cols-2 gap-4">
                              <div className="grid gap-1.5">
                                <label className="text-[12px] font-medium text-slate-700">ZIP / Postal</label>
                                <input name="zip" className={field} placeholder="94105" autoComplete="postal-code" />
                                {errors.zip && <div className="text-[12px] text-rose-600">{errors.zip}</div>}
                              </div>
                              <div className="grid gap-1.5">
                                <label className="text-[12px] font-medium text-slate-700">Country</label>
                                <input name="country" className={field} placeholder="United States" autoComplete="country-name" />
                                {errors.country && <div className="text-[12px] text-rose-600">{errors.country}</div>}
                              </div>
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
                              <ShieldCheckIcon className="h-4 w-4 text-slate-500" />
                              <span>Payments are encrypted and processed securely.</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Summary */}
                      <div className="lg:col-span-5">
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-200/60">
                          <div className="text-base font-semibold text-slate-900">Summary</div>

                          <div className="mt-4 space-y-4">
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
                              <div className="flex items-center justify-between text-[14px]">
                                <div className="font-semibold text-slate-900">{planSafe.name}</div>
                                <div className="text-slate-800">{fmt(planSafe.priceCents)}</div>
                              </div>
                              <div className="mt-0.5 text-[12px] text-slate-600">
                                Billed {planSafe.interval === 'year' ? 'yearly' : 'monthly'}
                              </div>
                              <div className="mt-2 text-[12px]">
                                <a href={managePlanHref} className="text-slate-700 underline underline-offset-2 hover:text-slate-900">
                                  Change plan
                                </a>
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
                                      {planSafe.name} ({planSafe.interval === 'year' ? 'Yearly' : 'Monthly'})
                                    </td>
                                    <td className="px-3 py-2 text-right">{fmt(planSafe.priceCents)}</td>
                                  </tr>
                                  {lineItems.map((li) => (
                                    <tr key={li.id}>
                                      <td className="px-3 py-2">{li.label}</td>
                                      <td className="px-3 py-2 text-right">{fmt(li.amountCents)}</td>
                                    </tr>
                                  ))}
                                  {discountCents > 0 && (
                                    <tr>
                                      <td className="px-3 py-2 text-emerald-700">Discount</td>
                                      <td className="px-3 py-2 text-right text-emerald-700">- {fmt(discountCents)}</td>
                                    </tr>
                                  )}
                                  {taxRate > 0 && (
                                    <tr>
                                      <td className="px-3 py-2 text-slate-600">Estimated tax ({Math.round((taxRate || 0) * 100)}%)</td>
                                      <td className="px-3 py-2 text-right text-slate-800">{fmt(taxCents)}</td>
                                    </tr>
                                  )}
                                  <tr className="bg-slate-50">
                                    <td className="px-3 py-2 font-semibold text-slate-900">Total</td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(totalCents)}</td>
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
                                {fmt(totalCents)} {planSafe.interval === 'year' ? '/yr' : '/mo'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </form>
                )
              ) : (
                // Success step
                <div className="px-5 py-8 sm:px-6">
                  <div className="mx-auto w-full max-w-[560px] text-center">
                    <motion.div
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                      className="mx-auto"
                    >
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-slate-700 shadow-lg ring-1 ring-black/10">
                        <CheckCircleIcon className="h-12 w-12 text-white" />
                      </div>
                    </motion.div>

                    <h3 className="mt-6 text-2xl font-semibold text-slate-900">{successTitle}</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Subscription confirmed{result?.last4 ? ` • Card ending ${result.last4}` : ''}.
                    </p>

                    <div className="mx-auto mt-6 w-full max-w-[560px] rounded-xl border border-slate-200 bg-slate-50 p-5 text-left">
                      <div className="flex items-center justify-between text-[14px]">
                        <div className="font-medium text-slate-900">{planSafe.name}</div>
                        <div className="font-semibold text-slate-900">
                          {fmt(totalCents)}{planSafe.interval === 'year' ? '/yr' : '/mo'}
                        </div>
                      </div>
                      <div className="mt-1 text-[12px] text-slate-600">
                        Billed {planSafe.interval === 'year' ? 'yearly' : 'monthly'}
                      </div>
                    </div>

                    <div className="mx-auto mt-6 flex w-full max-w-[560px] flex-col gap-3 sm:flex-row">
                      <a
                        href="/dashboard"
                        className="inline-flex w-full items-center justify-center rounded-md bg-[#2e2e30] px-4 py-3 text-[15px] font-medium text-white hover:opacity-90"
                      >
                        Continue to dashboard
                      </a>
                      {allowClose && (
                        <button
                          type="button"
                          onClick={onClose}
                          className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-[15px] font-medium text-slate-900 hover:bg-slate-50"
                        >
                          Close
                        </button>
                      )}
                    </div>

                    <div className="mt-3 text-[12px] text-slate-500">
                      We’ve emailed your receipt{result?.name ? ` to ${result.name}` : ''}.
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}