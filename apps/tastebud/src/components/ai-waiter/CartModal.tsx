// apps/tastebud/src/components/ai-waiter/TrayModal.tsx
import React from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import MicInputBar from './MicInputBar';
import type { AiReplyMeta, WaiterIntent } from '../../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../../utils/intent-routing';

type Props = {
  open: boolean;
  onClose: () => void;
  checkoutHrefOverride?: string;
  recentAiItems?: { id: string; name: string }[];
  upsellItems?: { itemId?: string; id?: string; title: string; price?: number }[];
  onIntent?: (intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) => void;
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
    /\/t\/[^/]+/.test(location.pathname) || (sd && location.pathname.startsWith('/t/'));

  if (isDev || subdomain) {
    return br ? `/t/${sd}/${br}/checkout` : `/t/${sd}/checkout`;
  }

  return '/checkout';
}

const BDT = new Intl.NumberFormat('en-BD');
const formatBDT = (n: number) => `৳${BDT.format(n)}`;

function resolveIntent(meta?: AiReplyMeta, replyText?: string): WaiterIntent {
  if (meta?.intent) return normalizeIntent(meta.intent);
  if (Array.isArray(meta?.items) && meta.items.length) return 'order';
  return localHeuristicIntent(replyText || '');
}

export default function TrayModal({
  open,
  onClose,
  checkoutHrefOverride,
  recentAiItems = [],
  upsellItems = [],
  onIntent,
}: Props) {
  const { items, subtotal, removeItem, clear, addItem } = useCart();
  const checkoutHref = useCheckoutHref(checkoutHrefOverride);

  const [autoUpsell, setAutoUpsell] = React.useState(upsellItems);

  React.useEffect(() => {
    if (upsellItems?.length) setAutoUpsell(upsellItems);
  }, [upsellItems]);

  const visibleUpsell = autoUpsell?.length ? autoUpsell : upsellItems;

  const hasItems = items.length > 0;
  const effectiveOpen = open && hasItems;

  React.useEffect(() => {
    if (open && !hasItems) onClose?.();
  }, [open, hasItems, onClose]);

  React.useEffect(() => {
    if (!effectiveOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [effectiveOpen, onClose]);

  if (!effectiveOpen) return null;

  const tenant =
    typeof window !== 'undefined'
      ? (window as any).__STORE__?.subdomain
      : undefined;

  const branch =
    typeof window !== 'undefined'
      ? (window as any).__STORE__?.branch
      : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]"
        onClick={onClose}
      />

      <div
        className={
          "relative z-[101] w-full sm:max-w-md rounded-t-[26px] sm:rounded-3xl bg-[#F8F8F8] h-[85vh] overflow-hidden sm:shadow-2xl " +
          "transform transition-all duration-300 ease-out " +
          (open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0")
        }
      >
        <div className="sticky top-0 z-20 px-4 pt-3 pb-2 border-b border-gray-100 bg-[#F8F8F8] rounded-t-[26px]">
          <div className="relative flex flex-col items-center">
            <div className="mb-2 h-1 w-12 rounded-full bg-gray-300" />
            <h2 className="text-[15px] font-semibold text-gray-900">Your Tray</h2>

            <button
              onClick={onClose}
              className="absolute right-0 top-0 h-8 w-8 grid place-items-center rounded-full hover:bg-gray-100 active:scale-95"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 0 0-1.41 1.41L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.41-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4Z"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-32 overflow-y-auto h-full">
          <div className="space-y-3">
            {items.map((it) => (
              <div
                key={`${it.id}:${it.variation ?? ''}`}
                className="flex items-center justify-between gap-3 border border-gray-100 rounded-2xl p-3 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {it.imageUrl ? (
                    <img
                      src={it.imageUrl}
                      alt={it.name}
                      className="h-12 w-12 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-gray-100" />
                  )}

                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-gray-900 truncate">
                      {it.name}
                    </div>
                    <div className="text-[12px] text-gray-600 truncate">
                      {it.variation ? `${it.variation} · ` : ''}
                      {formatBDT(it.price)} × {it.qty}
                    </div>
                    {it.notes && (
                      <div className="text-[12px] text-gray-500 truncate">{it.notes}</div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => removeItem(it.id, it.variation)}
                  className="h-8 w-8 grid place-items-center text-gray-400 hover:text-[#FA2851] rounded-full hover:bg-gray-100 transition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {visibleUpsell.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="text-sm font-semibold text-gray-800 mb-2">
                Recommended to go with your order
              </div>
              <div className="space-y-2">
                {visibleUpsell.map((u, i) => {
                  const id = u.itemId || u.id;
                  return (
                    <div key={`${id ?? 'u'}:${i}`} className="flex items-center justify-between gap-2 text-sm">
                      <div className="text-gray-800 truncate">
                        {u.title}
                        {typeof u.price === 'number' && (
                          <span className="text-gray-500 ml-1">· {formatBDT(u.price)}</span>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          id &&
                          addItem({
                            id,
                            name: u.title,
                            price: u.price || 0,
                            qty: 1,
                          })
                        }
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#FA2851]/10 text-[#FA2851] hover:bg-[#FA2851]/15"
                      >
                        Add
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* FIXED MIC BAR */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 mb-3 bg-[#F8F8F8] border-t border-gray-200 z-40">
          <MicInputBar
            tenant={tenant}
            branch={branch}
            channel="dine-in"
            onAiReply={({ replyText, meta }) => {
              const m = meta as AiReplyMeta | undefined;
              const intent = resolveIntent(m, replyText);

              const upsell = (m?.upsell || (m as any)?.Upsell || []) as any[];
              const decision = (m as any)?.decision || {};
              const showUpsell = decision?.showUpsellTray;

              if (showUpsell && upsell?.length) setAutoUpsell(upsell);

              onIntent?.(intent, m, replyText);
            }}
          />
        </div>
      </div>
    </div>
  );
}
