// apps/tastebud/src/components/ai-waiter/TrayModal.tsx
import React from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useCart } from '../../context/CartContext';

type Props = {
  open: boolean;
  onClose: () => void;
  checkoutHrefOverride?: string;
};

function useCheckoutHref(override?: string) {
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

  if (override) return override;
  const isDev =
    /\/t\/[^/]+/.test(location.pathname) ||
    (sd && location.pathname.startsWith('/t/'));
  if (isDev || subdomain) {
    return br ? `/t/${sd}/${br}/checkout` : `/t/${sd}/checkout`;
  }
  return '/checkout';
}

const BDT = new Intl.NumberFormat('en-BD');
const formatBDT = (n: number) => `৳${BDT.format(n)}`;

export default function TrayModal({ open, onClose, checkoutHrefOverride }: Props) {
  // ✅ Match CartContext API (subtotal & clear)
  const { items, subtotal, removeItem, clear } = useCart();
  const checkoutHref = useCheckoutHref(checkoutHrefOverride);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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

      {/* Tray body */}
      <div className="relative z-[101] w-full sm:max-w-md sm:rounded-2xl sm:shadow-2xl bg-white">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Your Tray</h2>
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

        {/* Content */}
        <div className="px-4 pt-3 pb-4 max-h-[70vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-center text-gray-500 py-10 text-sm">
              Your tray is empty.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((it) => (
                <div
                  key={`${it.id}:${it.variation ?? ''}`}
                  className="flex items-center justify-between gap-3 border border-gray-100 rounded-2xl p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Optional thumbnail */}
                    {it.imageUrl ? (
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="h-12 w-12 rounded-xl object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-gray-100" />
                    )}

                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-gray-900 truncate">
                        {it.name ?? 'Item'}
                      </div>
                      <div className="text-[12px] text-gray-600 truncate">
                        {it.variation ? `${it.variation} · ` : ''}
                        {formatBDT(it.price)} × {it.qty}
                      </div>
                      {it.notes ? (
                        <div className="text-[12px] text-gray-500 truncate">
                          {it.notes}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(it.id, it.variation)}
                    className="h-8 w-8 grid place-items-center text-gray-400 hover:text-[#FA2851] rounded-full hover:bg-gray-100 transition"
                    aria-label="Remove item"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <path
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 6l12 12M6 18L18 6"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
          {items.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-medium text-gray-800">Total</span>
              <span className="text-[17px] font-semibold text-[#FA2851]">
                {formatBDT(subtotal)}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={clear}
              disabled={items.length === 0}
              className="flex-1 px-4 py-2 rounded-full text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-95 transition disabled:opacity-50"
            >
              Clear
            </button>
            <Link
              to={checkoutHref}
              onClick={onClose}
              className="flex-[2] text-center px-4 py-2 rounded-full text-sm font-medium bg-[#FA2851] text-white shadow-[0_6px_20px_rgba(250,40,81,0.25)] active:scale-95 transition"
            >
              Checkout →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
