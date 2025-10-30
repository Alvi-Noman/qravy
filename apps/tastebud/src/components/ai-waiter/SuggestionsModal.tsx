// apps/tastebud/src/components/ai-waiter/SuggestionsModal.tsx
import React from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';

type Suggestion = {
  id: string;
  title: string;
  blurb: string;
  // optional tag you might use later to prefilter/search
  query?: string;
  // tiny emoji/icon; replace with images later if you like
  emoji?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  // Optional override if the parent wants to control where "See menu" goes.
  // If not provided, this component will resolve /menu from params/runtime.
  menuHrefOverride?: string;
};

function useMenuHref(menuHrefOverride?: string) {
  const { subdomain, branchSlug, branch } = useParams<{
    subdomain?: string;
    branchSlug?: string;
    branch?: string;
  }>();
  const [search] = useSearchParams();
  const location = useLocation();

  const sd =
    subdomain ??
    search.get('subdomain') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain ?? null : null);

  const br =
    branch ??
    branchSlug ??
    search.get('branch') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.branch ?? null : null) ??
    undefined;

  // If parent provided a target, honor it
  if (menuHrefOverride) return menuHrefOverride;

  // Dev-style routes if /t/:subdomain is present in URL; otherwise prod-style
  const isDevTenantPath = /\/t\/[^/]+/.test(location.pathname) || (sd && location.pathname.startsWith('/t/'));
  if (isDevTenantPath || subdomain) {
    return br ? `/t/${sd}/${br}/menu` : `/t/${sd}/menu`;
  }
  return '/menu';
}

const DUMMY_SUGGESTIONS: Suggestion[] = [
  { id: 'best', title: 'Best Sellers', blurb: 'Customer favorites picked for you', emoji: '⭐' },
  { id: 'burger', title: 'Juicy Burgers', blurb: 'Cheesy, double-stack, or spicy', emoji: '🍔', query: 'burger' },
  { id: 'pizza', title: 'Fresh Pizzas', blurb: 'Classic margherita to loaded', emoji: '🍕', query: 'pizza' },
  { id: 'rice', title: 'Rice Bowls', blurb: 'Hearty & flavorful bowls', emoji: '🍲', query: 'rice' },
  { id: 'drinks', title: 'Chilled Drinks', blurb: 'Cool down with something nice', emoji: '🥤', query: 'drinks' },
  { id: 'sweet', title: 'Desserts', blurb: 'Finish with something sweet', emoji: '🍰', query: 'dessert' },
];

export default function SuggestionsModal({ open, onClose, menuHrefOverride }: Props) {
  const menuHref = useMenuHref(menuHrefOverride);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]"
        onClick={onClose}
      />

      {/* Sheet / Modal card */}
      <div className="relative z-[101] w-full sm:max-w-2xl sm:rounded-2xl sm:shadow-2xl bg-white">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Suggestions for you</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-full hover:bg-gray-100 active:scale-95 transition"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 0 0-1.41 1.41L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pt-3 pb-4">
          <p className="text-sm text-gray-600 mb-3">
            Based on what you said, here are a few quick paths. Tap any card to jump into the menu.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DUMMY_SUGGESTIONS.map((s) => (
              <Link
                key={s.id}
                to={menuHref /* you may add `+ '?q=' + encodeURIComponent(s.query!)` once DigitalMenu reads it */}
                className="group rounded-2xl border border-gray-100 bg-white p-4 hover:shadow-md transition-shadow active:scale-[0.99]"
                onClick={onClose}
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl grid place-items-center bg-gray-50 text-lg">
                    {s.emoji ?? '🍽️'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-gray-900">{s.title}</h3>
                    <p className="text-[13px] text-gray-600 mt-0.5 line-clamp-2">{s.blurb}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12px] text-gray-500">
                    {/* Placeholder tag; keep for future filters */}
                    {s.query ? `#${s.query}` : '#menu'}
                  </span>
                  <span className="text-[12px] font-medium text-[#FA2851] group-hover:underline">
                    See options →
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Footer CTA */}
          <div className="mt-4 flex items-center justify-end gap-3">
            <Link
              to={menuHref}
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-[#FA2851] text-white text-sm font-medium shadow-[0_8px_24px_rgba(250,40,81,0.25)] active:scale-95 transition"
            >
              Open full menu
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
