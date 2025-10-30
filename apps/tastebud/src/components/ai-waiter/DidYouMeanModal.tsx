// apps/tastebud/src/components/ai-waiter/DidYouMeanModal.tsx
import React from 'react';

export type DidYouMeanOption = {
  id: string;
  name: string;
  score?: number;               // 0..1
  why?: string;                 // "phonetic" | "transliteration" | "category" | ...
  available?: boolean;
  price?: number | null;
  category?: string | null;
  category_id?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;

  // i18n/light context
  lang?: 'bn' | 'en';
  strategy?: string | null;
  category?: string | null;

  // results
  options: DidYouMeanOption[];

  // actions
  onPick: (opt: DidYouMeanOption) => void;
  onShowCategory?: (categoryId?: string | null, categoryName?: string | null) => void;
};

const T = {
  en: {
    title: 'Did you mean…',
    subtitle: 'We found some close matches',
    none: 'No good matches. Try rephrasing?',
    select: 'Add',
    unavailable: 'Unavailable',
    available: 'Available',
    seeCategory: (cat: string) => `Show all in “${cat}”`,
    reason: 'Reason',
    confidence: 'Confidence',
    tryAgain: 'Try again',
    strategy: 'Strategy',
  },
  bn: {
    title: 'আপনি কি এগুলোর কোনটি বলতে চেয়েছেন?',
    subtitle: 'আমরা কিছু মিল খুঁজে পেয়েছি',
    none: 'ভালো মিল পাওয়া যায়নি। আবার বলবেন?',
    select: 'নিন',
    unavailable: 'উপলভ্য নয়',
    available: 'উপলভ্য',
    seeCategory: (cat: string) => `“${cat}” ক্যাটাগরির সব দেখুন`,
    reason: 'কারণ',
    confidence: 'আত্মবিশ্বাস',
    tryAgain: 'আবার চেষ্টা করুন',
    strategy: 'কৌশল',
  },
};

function fmtPrice(p: number | null | undefined, lang: 'bn' | 'en') {
  if (p === null || p === undefined) return '';
  try {
    const nf = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 0 });
    return `৳${nf.format(p)}`;
  } catch {
    return `৳${p}`;
  }
}

function scoreBar(score?: number) {
  if (score === undefined || score === null) return 0;
  const s = Math.max(0, Math.min(1, score));
  return Math.round(s * 100);
}

export default function DidYouMeanModal({
  open,
  onClose,
  lang = 'bn',
  strategy,
  category,
  options,
  onPick,
  onShowCategory,
}: Props) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const L = T[lang] ?? T.en;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]" onClick={onClose} />

      {/* Card */}
      <div className="relative z-[101] w-full sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl bg-white">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{L.title}</h2>
            <p className="text-sm text-gray-600">{L.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {strategy ? (
              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                {L.strategy}: {strategy}
              </span>
            ) : null}
            <button
              onClick={onClose}
              className="h-9 w-9 grid place-items-center rounded-full hover:bg-gray-100 active:scale-95 transition"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 0 0-1.41 1.41L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 pt-3 pb-4">
          {/* Optional category CTA */}
          {category && onShowCategory ? (
            <button
              type="button"
              className="mb-3 inline-flex items-center text-xs font-medium px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 transition"
              onClick={() => onShowCategory(undefined, category)}
            >
              {L.seeCategory(category)}
            </button>
          ) : null}

          {/* Result list */}
          <div className="mt-1 max-h-[60vh] overflow-auto rounded-2xl border border-gray-100 divide-y">
            {options.length === 0 ? (
              <div className="p-4 text-sm text-gray-600">{L.none}</div>
            ) : (
              options.slice(0, 12).map((opt, idx) => {
                const price = fmtPrice(opt.price ?? null, lang);
                const conf = scoreBar(opt.score);
                const available = opt.available !== false;
                return (
                  <div key={opt.id} className="p-3 flex items-center justify-between gap-3">
                    {/* Left: info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-gray-900 truncate">{opt.name}</h4>
                        {opt.category ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 shrink-0">
                            {opt.category}
                          </span>
                        ) : null}
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                            available ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {available ? L.available : L.unavailable}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        {price ? <span className="font-medium">{price}</span> : null}
                        {opt.why ? (
                          <span className="inline-flex items-center gap-1">
                            <strong className="opacity-75">{L.reason}:</strong> {opt.why}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-2">
                          <strong className="opacity-75">{L.confidence}:</strong>
                          <span className="w-20 h-1.5 rounded-full bg-gray-100 relative overflow-hidden">
                            <span
                              className="absolute inset-y-0 left-0 rounded-full bg-gray-800/70"
                              style={{ width: `${conf}%` }}
                            />
                          </span>
                          <span className="tabular-nums">{conf}%</span>
                        </span>
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {opt.category && onShowCategory ? (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50"
                          onClick={() => onShowCategory(opt.category_id ?? null, opt.category ?? null)}
                          title={opt.category ? L.seeCategory(opt.category) : undefined}
                        >
                          {lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:opacity-90 active:scale-95 transition"
                        onClick={() => onPick(opt)}
                        autoFocus={idx === 0}
                      >
                        {L.select}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-full border border-gray-200 hover:bg-gray-50 text-sm font-medium active:scale-95 transition"
              onClick={onClose}
            >
              {L.tryAgain}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
