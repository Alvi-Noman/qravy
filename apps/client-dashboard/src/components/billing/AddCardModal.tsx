// apps/client-dashboard/src/components/billing/AddCardModal.tsx
import { useState } from 'react';
import { XMarkIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import api from '../../api/auth';

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

export default function AddCardModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [brand, setBrand] = useState<CardBrand>('unknown');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Focus: solid black border, no ring
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

  function validate(fd: FormData) {
    const name = String(fd.get('name') || '').trim();
    const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
    const exp = String(fd.get('exp') || '').trim();
    const cvc = String(fd.get('cvc') || '').trim();
    const zip = String(fd.get('zip') || '').trim();
    const newErrors: Record<string, string> = {};
    if (!name) newErrors.name = 'Name is required';
    if (brand === 'amex') { if (cardDigits.length !== 15 || !luhnCheck(cardDigits)) newErrors.card = 'Enter a valid Amex number'; }
    else if (cardDigits.length < 13 || cardDigits.length > 19 || !luhnCheck(cardDigits)) newErrors.card = 'Enter a valid card number';
    if (!/^\d{2}\/\d{2}$/.test(exp)) newErrors.exp = 'Use MM/YY format';
    else { const mm = Number(exp.split('/')[0]); if (mm < 1 || mm > 12) newErrors.exp = 'Invalid month'; }
    const expectedCvcLen = brand === 'amex' ? 4 : 3;
    if (!/^\d+$/.test(cvc) || cvc.length !== expectedCvcLen) newErrors.cvc = `Enter a ${expectedCvcLen}-digit CVC`;
    if (!zip) newErrors.zip = 'ZIP/Postal is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const fd = new FormData(e.currentTarget);
    if (!validate(fd)) return;
    setSubmitting(true);
    try {
      const cardDigits = String(fd.get('card') || '').replace(/\D/g, '');
      const expStr = String(fd.get('exp') || '');
      const [mmStr, yyStr] = expStr.split('/');
      const expMonth = Number(mmStr);
      const expYear = 2000 + Number(yyStr);
      const normalizedBrand = brand === 'visa_electron' ? 'visa' : brand;

      await api.post('/api/v1/auth/tenants/payment-method', {
        provider: 'mock',
        brand: normalizedBrand,
        last4: cardDigits.slice(-4),
        expMonth,
        expYear,
        // Optional to send if backend expects it:
        // country: String(fd.get('country') || '').trim(),
        // address: String(fd.get('address') || '').trim(),
        // postalCode: String(fd.get('zip') || '').trim(),
      });

      await onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1100]">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ececec] px-5 py-4">
            <div className="text-[15px] font-semibold text-slate-900">Add new payment method</div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-slate-50">
              <XMarkIcon className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-5">
            <div className="grid gap-4">
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
                    placeholder={brand === 'amex' ? '••••' : '•••'}
                    maxLength={brand === 'amex' ? 4 : 3}
                    onInput={handleDigitsOnly(brand === 'amex' ? 4 : 3)}
                  />
                  {errors.cvc && <div className="text-[12px] text-rose-600">{errors.cvc}</div>}
                </div>
              </div>

              {/* Address full width */}
              <div className="grid gap-1.5">
                <label className="text-[13px] font-medium text-slate-700">Address</label>
                <input name="address" className={field} placeholder="123 Market St" autoComplete="address-line1" />
              </div>

              {/* ZIP first, then Country */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <label className="text-[13px] font-medium text-slate-700">ZIP / Postal</label>
                  <input name="zip" className={field} placeholder="94105" autoComplete="postal-code" />
                  {errors.zip && <div className="text-[12px] text-rose-600">{errors.zip}</div>}
                </div>
                <div className="grid gap-1.5">
                  <label className="text-[13px] font-medium text-slate-700">Country</label>
                  <input name="country" className={field} placeholder="United States" autoComplete="country-name" />
                </div>
              </div>

              <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
                <ShieldCheckIcon className="h-4 w-4 text-slate-500" />
                <span>Payments are encrypted and processed securely.</span>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-[#e2e2e2] bg-white px-3 py-2 text-[13px] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[#2e2e30] px-4 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? 'Saving…' : 'Save card'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}