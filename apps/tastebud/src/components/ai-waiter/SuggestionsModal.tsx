// apps/tastebud/src/components/ai-waiter/SuggestionsModal.tsx
import React from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import MicInputBar from './MicInputBar';
import type { AiReplyMeta, WaiterIntent } from '../../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../../utils/intent-routing';

type MinimalMenuItem = {
  id?: string;
  name?: string;
  price?: number;
  imageUrl?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  menuHrefOverride?: string;
  items?: MinimalMenuItem[];
  onIntent?: (intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) => void;
};

/* ---------- Helpers ---------- */

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
    (typeof window !== 'undefined'
      ? (window as any).__STORE__?.subdomain ?? null
      : null);

  const br =
    branch ??
    branchSlug ??
    search.get('branch') ??
    (typeof window !== 'undefined'
      ? (window as any).__STORE__?.branch ?? null
      : null) ??
    undefined;

  if (menuHrefOverride) return menuHrefOverride;

  const isDevTenantPath =
    /\/t\/[^/]+/.test(location.pathname) ||
    (sd && location.pathname.startsWith('/t/'));

  if (isDevTenantPath || subdomain) {
    return br ? `/t/${sd}/${br}/menu` : `/t/${sd}/menu`;
  }
  return '/menu';
}

function resolveIntent(meta?: AiReplyMeta, replyText?: string): WaiterIntent {
  if (meta?.intent) return normalizeIntent(meta.intent);
  if (Array.isArray(meta?.items) && meta.items.length) return 'order';
  return localHeuristicIntent(replyText || '');
}

const BDT = new Intl.NumberFormat('en-BD');
function formatCurrency(n?: number) {
  if (typeof n !== 'number') return undefined;
  return `৳ ${BDT.format(n)}`;
}

/* ---------- Inline Product Card (minimal) ---------- */

type ProductSuggestionCardProps = {
  item: MinimalMenuItem;
  className?: string;
};

function ProductSuggestionCardBase({ item, className }: ProductSuggestionCardProps): JSX.Element {
  const name = item.name ?? 'Item';
  const price = item.price;
  const image = item.imageUrl;

  return (
    <article
      aria-label={name}
      className={
        'group relative flex w-full flex-row-reverse items-start gap-4 rounded-[26px] bg-white p-4 sm:p-5 font-[Inter] ' +
        'shadow-[0_1px_4px_rgba(0,0,0,0.05)] transition-all duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)] hover:-translate-y-[1px] cursor-pointer ' +
        (className ?? '')
      }
    >
      <div className="relative h-[90px] w-[90px] sm:h-[110px] sm:w-[110px] overflow-hidden rounded-[16px]">
        {image ? (
          <img
            src={image}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full rounded-[16px] bg-gray-100 grid place-items-center text-xl">🍽️</div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-[16px] sm:text-[17px] font-semibold text-neutral-900">{name}</h3>
        <span className="mt-1 text-[16px] font-semibold text-neutral-900">
          {formatCurrency(price) ?? '—'}
        </span>
        <div className="mt-auto h-3" />
      </div>
    </article>
  );
}

const ProductSuggestionCard = React.memo(
  ProductSuggestionCardBase,
  (prev, next) =>
    prev.item.id === next.item.id &&
    prev.item.name === next.item.name &&
    prev.item.price === next.item.price &&
    prev.item.imageUrl === next.item.imageUrl &&
    prev.className === next.className
);

/* ---------- Modal Component ---------- */

export default function SuggestionsModal({
  open,
  onClose,
  menuHrefOverride,
  items = [],
  onIntent,
}: Props) {
  const menuHref = useMenuHref(menuHrefOverride);
  const hasAiItems = Array.isArray(items) && items.length > 0;
  const heroItem = hasAiItems ? items.find((i) => i.imageUrl) ?? items[0] : undefined;
  const heroImage = heroItem?.imageUrl;
  const heroName = heroItem?.name;

  const tenant = typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : undefined;
  const branch = typeof window !== 'undefined' ? (window as any).__STORE__?.branch : undefined;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]" onClick={onClose} />

      {/* 85vh SLIDE-UP ANIMATED CONTAINER */}
      <div
        className={
          "relative z-[101] w-full sm:max-w-2xl rounded-t-[26px] sm:rounded-3xl bg-[#F8F8F8] h-[85vh] overflow-hidden sm:shadow-2xl " +
          "transform transition-all duration-300 ease-out " +
          (open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0")
        }
      >
        
        {/* HEADER */}
        <div className="sticky top-0 z-20 px-4 pt-3 pb-2 border-b border-gray-100 bg-[#F8F8F8] rounded-t-[26px]">
          <div className="relative flex flex-col items-center">
            <div className="mb-2 h-1 w-12 rounded-full bg-gray-300" />

            {heroImage && (
              <div className="mb-2 h-10 w-10 rounded-full overflow-hidden border border-white/70 shadow-sm">
                <img src={heroImage} alt={heroName ?? 'Item'} className="h-full w-full object-cover" />
              </div>
            )}

            <h2 className="text-[15px] font-semibold text-gray-900">AI Suggestions</h2>

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

        {/* SCROLL AREA */}
        <div className="px-4 pt-3 pb-24 overflow-y-auto h-full">
          {hasAiItems ? (
            <div className="grid grid-cols-1 gap-3">
              {items.map((it, idx) => (
                <Link
                  key={String(it.id ?? idx)}
                  to={menuHref}
                  onClick={onClose}
                  className="block"
                >
                  <ProductSuggestionCard item={it} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-gray-500">No suggestions available right now.</div>
          )}
        </div>

        {/* GRADIENT */}
        <div className="pointer-events-none absolute bottom-[88px] left-0 right-0 h-12 bg-gradient-to-t from-[#F8F8F8] to-transparent z-30" />

        {/* FIXED MIC INPUT BAR WITH GAP */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 mb-3 bg-[#F8F8F8] border-t border-gray-200 z-40">
          <MicInputBar
            tenant={tenant}
            branch={branch}
            channel="dine-in"
            onAiReply={({ replyText, meta }) => {
              const intent = resolveIntent(meta as AiReplyMeta | undefined, replyText);
              onIntent?.(intent, meta as AiReplyMeta | undefined, replyText);
            }}
          />
        </div>

      </div>
    </div>
  );
}
