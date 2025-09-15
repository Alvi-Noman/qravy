import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, LockClosedIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

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
  }) => Promise<void> | void;

  managePlanHref?: string;
  allowClose?: boolean;
  onClose?: () => void;
  testMode?: boolean;
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
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState<CardBrand>('unknown');
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

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

  const fieldCls =
    'w-full rounded-md border border-[#dbdbdb] px-3 py-2 text-sm transition-colors focus:outline-none focus:border-[#111827] placeholder:text-slate-400';

  // Map detected brand to your public/brands/*.svg files
  const brandIconMap: Record<CardBrand, string | null> = {
    visa: '/brands/visa.svg',
    visa_electron: '/brands/visa-electron.svg',
    amex: '/brands/american-express.svg',
    mastercard: '/brands/mastercard.svg',
    discover: '/brands/discover.svg',
    jcb: '/brands/jcb.svg',
    maestro: '/brands/maestro.svg',
    diners: '/brands/cb.svg', // replace if you add diners.svg
    unionpay: null,
    unknown: null,
  };

  // ---------- Card helpers ----------
  function detectBrand(digits: string): CardBrand {
    if (/^(4026|417500|4508|4844|4913|4917)/.test(digits)) return 'visa_electron';
    if (/^4\d{0,}$/.test(digits)) return 'visa';
    if (/^(5[1-5]|2(2[2-9]\d|[3-6]\d{2}|7[01]\d|720))\d{0,}$/.test(digits)) return 'mastercard';
    if (/^3[47]\d{0,}$/.test(digits)) return 'amex';
    if (/^6(?:011|5|4[4-9])\d{0,}$/.test(digits)) return 'discover';
    if (/^3(?:0[0-5]|[68]\d)\d{0,}$/.test(digits)) return 'diners';
    if (/^(?:2131|1800|35)\d{0,}$/.test(digits)) return 'jcb';
    if (/^(50|5[6-9]|6)\d{0,}$/.test(digits)) return 'maestro';
    if (/^62\d{0,}$/.test(digits)) return 'unionpay';
    return 'unknown';
  }

  function formatCardNumber(digits: string, b: CardBrand): string {
    if (b === 'amex') {
      const p1 = digits.slice(0, 4);
      const p2 = digits.slice(4, 10);
      const p3 = digits.slice(10, 15);
      return [p1, p2, p3].filter(Boolean).join(' ');
    }
    return digits.match(/.{1,4}/g)?.join(' ') ?? digits;
  }

  function boundariesForBrand(b: CardBrand): number[] {
    return b === 'amex' ? [4, 10] : [4, 8, 12, 16];
  }

  function formatCardNumberAndCaret(allDigits: string, b: CardBrand, digitsBeforeCaret: number) {
    const formatted = formatCardNumber(allDigits, b);
    const boundaries = boundariesForBrand(b);
    const spacesBefore = boundaries.filter((n) => digitsBeforeCaret >= n).length;
    const caret = Math.min(formatted.length, digitsBeforeCaret + spacesBefore);
    return { formatted, caret };
  }

  function handleCardInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const prevCursor = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, prevCursor).replace(/\D/g, '').slice(0, 19);
    const allDigits = el.value.replace(/\D/g, '').slice(0, 19);

    const b = detectBrand(allDigits);
    setBrand(b);

    const { formatted, caret } = formatCardNumberAndCaret(allDigits, b, digitsBefore.length);
    el.value = formatted;

    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
    });
  }

  // ---------- Expiry helpers (MM/YY with locked slash) ----------
  function formatExpiry(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) return '';
    if (digits.length < 2) return digits;
    if (digits.length === 2) return `${digits}/`;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  function handleExpInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const prevCursor = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, prevCursor).replace(/\D/g, '').slice(0, 4);
    const formatted = formatExpiry(el.value);
    el.value = formatted;

    let newPos: number;
    if (digitsBefore.length < 2) newPos = digitsBefore.length;
    else if (digitsBefore.length === 2) newPos = 3;
    else newPos = digitsBefore.length + 1;

    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(newPos, newPos);
      } catch {}
    });
  }

  function handleExpKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const pos = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? pos;
    const hasSel = end > pos;

    if (e.key === 'Backspace' && !hasSel && pos === 3) {
      e.preventDefault();
      const digits = el.value.replace(/\D/g, '');
      if (digits.length >= 2) {
        const newDigits = digits[0] + digits.slice(2);
        const formatted = formatExpiry(newDigits);
        el.value = formatted;
        requestAnimationFrame(() => {
          try {
            const p = Math.min(2, formatted.length);
            el.setSelectionRange(p, p);
          } catch {}
        });
      }
      return;
    }

    if (e.key === 'Delete' && !hasSel && pos === 2) {
      e.preventDefault();
      const digits = el.value.replace(/\D/g, '');
      if (digits.length > 2) {
        const newDigits = digits.slice(0, 2) + digits.slice(3);
        const formatted = formatExpiry(newDigits);
        el.value = formatted;
      }
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(3, 3);
        } catch {}
      });
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      return;
    }
  }

  // ---------- Digits-only helper (CVC) ----------
  function handleDigitsOnly(maxLen?: number) {
    return (e: React.FormEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      const digits = el.value.replace(/\D/g, '');
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

  const validate = (fd: FormData) => {
    const name = String(fd.get('name') || '').trim();
    const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
    const exp = String(fd.get('exp') || '').trim();
    const cvc = String(fd.get('cvc') || '').trim();
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
    if (!/^\d+$/.test(cvc) || cvc.length !== expectedCvcLen) {
      newErrors.cvc = `Enter a ${expectedCvcLen}-digit CVC`;
    }

    if (!zip) newErrors.zip = 'ZIP/Postal is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const fd = new FormData(e.currentTarget);
    if (!validate(fd)) return;

    setSubmitting(true);
    try {
      const name = String(fd.get('name') || '').trim();
      const fakeToken = 'tok_' + Math.random().toString(36).slice(2, 10);
      await Promise.resolve(onSubscribe({ name, cardToken: fakeToken, planId: planSafe.id }));
    } finally {
      setSubmitting(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const cvcMaxLen = brand === 'amex' ? 4 : 3;
  const cvcPlaceholder = brand === 'amex' ? '••••' : '•••';
  const brandIconSrc = brandIconMap[brand];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm"
          aria-modal="true"
          role="dialog"
          aria-label="Checkout"
          onMouseDown={() => allowClose && onClose?.()}
        >
          <div className="grid h-full place-items-center p-4" onMouseDown={stop}>
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="relative w-full max-w-5xl rounded-2xl bg-white p-0 shadow-2xl"
              style={{ willChange: 'transform' }}
            >
              {/* Header with FA2851 */}
              <div
                className="flex items-start justify-between rounded-t-2xl px-6 py-5"
                style={{ backgroundColor: '#FA2851', color: '#fff' }}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <LockClosedIcon className="h-5 w-5 text-white" />
                    <h2 className="text-lg font-semibold">Your trial period has ended</h2>
                  </div>
                  <p className="mt-1 text-sm opacity-95">
                    To continue using your account, choose a plan and add your payment details. Your menu will remain
                    offline until you subscribe.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {testMode && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/30">
                      Test mode
                    </span>
                  )}
                  {allowClose && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md p-2 hover:bg-white/10"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5 text-white" />
                    </button>
                  )}
                </div>
              </div>

              {/* Form grid — items-stretch ensures columns are equal height; panels use h-full */}
              <form className="grid items-stretch gap-6 p-6 sm:grid-cols-5" onSubmit={handleSubmit}>
                {/* Left: payment */}
                <div className="sm:col-span-3 min-w-0 min-h-0 self-stretch">
                  <div className="h-full rounded-lg border border-[#ececec] p-4 flex flex-col">
                    <div className="text-sm font-medium text-slate-900">Payment details</div>

                    <div className="mt-3 grid gap-3">
                      {/* Name on card */}
                      <div className="grid gap-1.5">
                        <label className="text-[12px] font-medium text-slate-700">Name on card</label>
                        <input
                          name="name"
                          className={fieldCls}
                          placeholder="Jane Doe"
                          autoComplete="cc-name"
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={errors.name ? 'err-name' : undefined}
                        />
                        {errors.name && <div id="err-name" className="text-[11px] text-rose-600">{errors.name}</div>}
                      </div>

                      {/* Card number + brand SVG inside the field */}
                      <div className="grid gap-1.5">
                        <label className="text-[12px] font-medium text-slate-700">Card number</label>
                        <div className="relative">
                          <input
                            name="card"
                            inputMode="numeric"
                            autoComplete="cc-number"
                            className={`${fieldCls} pr-14`}
                            placeholder="4242 4242 4242 4242"
                            onInput={handleCardInput}
                            aria-invalid={Boolean(errors.card)}
                            aria-describedby={errors.card ? 'err-card' : undefined}
                          />
                          {brandIconSrc && (
                            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                              <img
                                src={brandIconSrc}
                                alt={brand}
                                className="h-6 w-auto select-none"
                                loading="eager"
                                draggable={false}
                              />
                            </div>
                          )}
                        </div>
                        {errors.card && <div id="err-card" className="text-[11px] text-rose-600">{errors.card}</div>}
                      </div>

                      {/* Row: Expiry + CVC */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <label className="text-[12px] font-medium text-slate-700">Expiry</label>
                          <input
                            name="exp"
                            inputMode="numeric"
                            autoComplete="cc-exp"
                            className={fieldCls}
                            placeholder="MM/YY"
                            maxLength={5}
                            onInput={handleExpInput}
                            onKeyDown={handleExpKeyDown}
                            aria-invalid={Boolean(errors.exp)}
                            aria-describedby={errors.exp ? 'err-exp' : undefined}
                          />
                          {errors.exp && <div id="err-exp" className="text-[11px] text-rose-600">{errors.exp}</div>}
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-[12px] font-medium text-slate-700">CVC</label>
                          <input
                            type="password"
                            name="cvc"
                            inputMode="numeric"
                            autoComplete="cc-csc"
                            className={fieldCls}
                            placeholder={cvcPlaceholder}
                            maxLength={cvcMaxLen}
                            onInput={handleDigitsOnly(cvcMaxLen)}
                            aria-invalid={Boolean(errors.cvc)}
                            aria-describedby={errors.cvc ? 'err-cvc' : undefined}
                          />
                          {errors.cvc && <div id="err-cvc" className="text-[11px] text-rose-600">{errors.cvc}</div>}
                        </div>
                      </div>

                      {/* Row: Country + ZIP/Postal */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <label className="text-[12px] font-medium text-slate-700">Country</label>
                          <input
                            name="country"
                            className={fieldCls}
                            placeholder="United States"
                            autoComplete="country-name"
                          />
                          {/* reserve space so ZIP error doesn't shift layout */}
                          <div className="h-[14px]" aria-hidden />
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-[12px] font-medium text-slate-700">ZIP / Postal</label>
                          <input
                            name="zip"
                            className={fieldCls}
                            placeholder="94105"
                            autoComplete="postal-code"
                            aria-invalid={Boolean(errors.zip)}
                            aria-describedby={errors.zip ? 'err-zip' : undefined}
                          />
                          <div className="min-h-[14px]">
                            {errors.zip && (
                              <div id="err-zip" className="text-[11px] leading-4 text-rose-600">
                                {errors.zip}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <ShieldCheckIcon className="h-4 w-4 text-slate-500" />
                        <span>Payments are encrypted and processed securely.</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Summary — equal height via h-full and flex */}
                <div className="sm:col-span-2 min-w-0 min-h-0 self-stretch">
                  <div className="h-full rounded-lg border border-[#ececec] p-4 flex flex-col">
                    <div className="text-sm font-medium text-slate-900">Summary</div>

                    {/* scroll/stack content grows; CTA stays bottom */}
                    <div className="mt-3 flex-1 flex flex-col gap-3">
                      {/* Summary card */}
                      <div className="rounded-md border border-[#eaeaea] bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="font-semibold text-slate-900">{planSafe.name}</div>
                          <div className="text-slate-700">{fmt(planSafe.priceCents)}</div>
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

                      {/* Item/Amount table */}
                      <div className="overflow-hidden rounded-md border border-[#f0f0f0]">
                        <table className="w-full table-fixed text-left text-[13px]">
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
                            <tr>
                              <td className="px-3 py-2 text-slate-600">Subtotal</td>
                              <td className="px-3 py-2 text-right text-slate-700">{fmt(subtotalCents)}</td>
                            </tr>
                            <tr className="bg-slate-50">
                              <td className="px-3 py-2 font-semibold text-slate-900">Total</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                {fmt(totalCents)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Bottom CTA fixed at panel bottom */}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="mt-4 inline-flex w-full items-center justify-between rounded-md bg-[#2e2e30] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                    >
                      <span>Subscribe</span>
                      <span className="opacity-90">
                        {fmt(totalCents)} {planSafe.interval === 'year' ? '/yr' : '/mo'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}