// apps/tastebud/src/components/ai-waiter/OrderConfirmedModal.tsx
// Shown once, right after an order is placed: the order number the guest can quote at the counter.
import { useEffect } from 'react';
import { money, tr, type UiLang } from '../../utils/ui-lang';
import { roundForGuest } from '../../utils/wait-time';

type Props = {
  open: boolean;
  onClose: () => void;
  orderNumber: number;
  table: string;
  total: number;
  /** Wait-time estimate when the order was placed */
  minutesLeft?: number;
  lang: UiLang;
};

export default function OrderConfirmedModal({ open, onClose, orderNumber, table, total, minutesLeft, lang }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-confirmed-title"
      className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/40 px-6"
      onClick={onClose}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 id="order-confirmed-title" className="text-lg font-semibold text-gray-900">
          {tr(lang, 'অর্ডার কনফার্ম করা হয়েছে', 'Order confirmed')}
        </h2>
        <div className="mt-3 text-5xl font-bold tracking-tight text-gray-900">#{orderNumber}</div>
        <p className="mt-3 text-sm text-gray-600">
          {tr(lang, `টেবিল ${table} · মোট ${money(total)}`, `Table ${table} · Total ${money(total)}`)}
        </p>
        {typeof minutesLeft === 'number' && minutesLeft > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-sm font-medium text-[#FA2851]">
            {tr(lang, `প্রায় ${roundForGuest(minutesLeft)} মিনিটে তৈরি হবে`, `Ready in about ${roundForGuest(minutesLeft)} min`)}
          </p>
        )}
        <p className="mt-2 text-sm text-gray-600">
          {tr(lang, 'বিল কাউন্টারে দেবেন — এই নম্বরটা বলবেন।', 'Pay at the counter — just quote this number.')}
        </p>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-2xl bg-[#FA2851] py-3 font-semibold text-white">
          {tr(lang, 'ঠিক আছে', 'OK')}
        </button>
      </div>
    </div>
  );
}
