// apps/tastebud/src/components/WaitEstimateLine.tsx
// "Ready in about 20 min" for the cart — before the guest places the order.
import type { WaitEstimate } from '../api/orders';
import { roundForGuest } from '../utils/wait-time';
import { tr, type UiLang } from '../utils/ui-lang';

export default function WaitEstimateLine({
  estimate,
  lang,
  className = '',
}: {
  estimate: WaitEstimate | null;
  lang: UiLang;
  className?: string;
}) {
  if (!estimate || estimate.totalMinutes <= 0) return null;
  const m = roundForGuest(estimate.totalMinutes);
  const busy = estimate.busy === 'busy';
  return (
    <div
      className={`flex items-center gap-2 text-[13px] ${busy ? 'text-amber-700' : 'text-gray-600'} ${className}`}
      aria-live="polite"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 6v4.2l2.6 1.6" strokeLinecap="round" />
      </svg>
      <span>
        {tr(lang, `অর্ডার দিলে প্রায় ${m} মিনিটে তৈরি হবে`, `Ready in about ${m} min if you order now`)}
        {busy && (
          <span className="text-amber-700">
            {' · '}
            {tr(lang, 'কিচেনে এখন ভিড়', 'the kitchen is busy')}
          </span>
        )}
      </span>
    </div>
  );
}
