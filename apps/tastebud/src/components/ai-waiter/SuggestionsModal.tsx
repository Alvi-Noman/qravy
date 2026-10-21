// apps/tastebud/src/components/ai-waiter/SuggestionsModal.tsx
import React from 'react';
import { track } from '../../utils/track';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import MicInputBar from './MicInputBar';
import SheetScrollArea, { ScrollLock } from '../SheetScroll';
import PopupHeader, { POPUP_PAGE_CLASS } from './PopupHeader';
import type { AiReplyMeta, WaiterIntent } from '../../types/waiter-intents';
import { isDineInPath, withTable } from '../../utils/table';
import { normalizeIntent, localHeuristicIntent } from '../../utils/intent-routing';
import { priceNumber } from '../../utils/ui-lang';
import QuickAdd from '../QuickAdd';
import Modal from '../Modal';
import { useCart } from '../../context/CartContext';

type MinimalMenuItem = {
  id?: string;
  name?: string;
  price?: number;
  imageUrl?: string;
  /** sizes / add-ons to pick first ("+" asks the waiter for it, and it asks which) */
  choices?: boolean;
  /** can't be ordered right now */
  orderable?: boolean;
  /** the dish as on the menu (sizes, add-ons, pictures) — its popup, on "+" */
  full?: any;
};

type Props = {
  open: boolean;
  onClose: () => void;
  menuHrefOverride?: string;
  items?: MinimalMenuItem[];
  /** dishes the waiter pointed at when the guest asked about this list ("which of these is less spicy?") */
  highlightIds?: string[];
  onIntent?: (intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) => void;
  /** its own mic bar — off where a hands-free voice session runs the conversation (the waiter home) */
  voiceBar?: boolean;
  /** the waiter's presence (AssistantDock) at the bottom of the page */
  assistant?: React.ReactNode;
  /** the guest is ordering by hand ("+" pressed): no orb — a "View your tray" bar at the bottom instead */
  manual?: boolean;
  onManual?: () => void;
  onViewTray?: () => void;
  lang?: 'bn' | 'en';
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

  // the menu on the guest's side of the site ("…/dine-in/menu?table=12" or the online "…/menu")
  const side = isDineInPath(location.pathname) ? '/dine-in' : '';
  if (isDevTenantPath || subdomain) {
    return withTable(br ? `/t/${sd}/${br}${side}/menu` : `/t/${sd}${side}/menu`, sd);
  }
  return withTable(`${br ? `/${br}` : ''}${side}/menu`, sd);
}

function resolveIntent(meta?: AiReplyMeta, replyText?: string): WaiterIntent {
  if (meta?.intent) return normalizeIntent(meta.intent);
  if (Array.isArray(meta?.items) && meta.items.length) return 'order';
  return localHeuristicIntent(replyText || '');
}

function formatCurrency(n?: number) {
  if (typeof n !== 'number') return undefined;
  return `৳ ${priceNumber(n)}`;
}

/* ---------- Inline Product Card (minimal) ---------- */

type ProductSuggestionCardProps = {
  item: MinimalMenuItem;
  className?: string;
  /** "+" on a dish with sizes / add-ons: its popup (as on the menu) */
  onChoose?: (item: MinimalMenuItem) => void;
  onAdd?: () => void;
};

function ProductSuggestionCardBase({ item, className, onChoose, onAdd }: ProductSuggestionCardProps): JSX.Element {
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
      <div className="relative h-[90px] w-[90px] sm:h-[110px] sm:w-[110px] shrink-0">
        <div className="h-full w-full overflow-hidden rounded-[16px]">
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
        {/* "+" → one in the tray, then "− 1 +" (as on the menu); sizes / add-ons → the dish's popup */}
        <QuickAdd
          className="absolute -bottom-2 -right-2"
          id={item.id}
          name={name}
          price={price}
          imageUrl={image}
          choices={item.choices}
          onChoose={() => onChoose?.(item)}
          onAdd={onAdd}
          disabled={item.orderable === false}
        />
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
    prev.item.choices === next.item.choices &&
    prev.item.orderable === next.item.orderable &&
    prev.onChoose === next.onChoose &&
    prev.onAdd === next.onAdd &&
    prev.className === next.className
);

/* ---------- Modal Component ---------- */

export default function SuggestionsModal({
  open,
  onClose,
  menuHrefOverride,
  items = [],
  highlightIds = [],
  onIntent,
  manual = false,
  onManual,
  onViewTray,
  lang = 'bn',
  voiceBar = true,
  assistant,
}: Props) {
  const hl = new Set(highlightIds.map(String));
  const cardRefs = React.useRef<Record<string, HTMLElement | null>>({});
  React.useEffect(() => {
    if (open) track('suggestions_opened');
  }, [open]);
  React.useEffect(() => {
    // bring the first highlighted dish into view
    const first = highlightIds.find((id) => cardRefs.current[id]);
    if (first) cardRefs.current[first]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightIds]);
  const menuHref = useMenuHref(menuHrefOverride);
  const hasAiItems = Array.isArray(items) && items.length > 0;
  const { count, subtotal } = useCart();
  // the dish whose sizes / add-ons are being picked (the menu's own popup)
  const [choosing, setChoosing] = React.useState<MinimalMenuItem | null>(null);
  const onChoose = React.useCallback((it: MinimalMenuItem) => setChoosing(it), []);

  // the restaurant from the link (/t/<subdomain>/…) like the home screen, then the global store value
  const params = useParams<{ subdomain?: string; branchSlug?: string; branch?: string }>();
  const [searchQ] = useSearchParams();
  const store = typeof window !== 'undefined' ? (window as any).__STORE__ : undefined;
  const tenant: string | undefined = params.subdomain ?? searchQ.get('subdomain') ?? store?.subdomain ?? undefined;
  const branch: string | undefined = params.branchSlug ?? params.branch ?? store?.branch ?? undefined;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-center bg-white">
      <ScrollLock />

      {/* FULL-SCREEN PAGE: title · scrolling cards · the waiter's dock (or the mic), as a column */}
      <div className={POPUP_PAGE_CLASS}>
        <PopupHeader
          title="AI Suggestions"
          onClose={onClose}
          // the whole menu, one tap away (top left — the close button is on the right)
          left={
            <Link
              to={menuHref}
              onClick={onClose}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-800 shadow-sm active:scale-95"
            >
              {lang === 'en' ? 'Full menu' : 'পুরো মেনু'}
            </Link>
          }
        />

        {/* SCROLL AREA */}
        <SheetScrollArea className="px-4 pt-2 pb-4" fadeFrom="#FFFFFF" moreHint={items.length > 2 ? 'More below' : undefined}>
          {hasAiItems ? (
            <div className="grid grid-cols-1 gap-3">
              {items.map((it, idx) => {
                const on = it.id != null && hl.has(String(it.id));
                return (
                  <Link
                    key={String(it.id ?? idx)}
                    ref={(el) => {
                      if (it.id != null) cardRefs.current[String(it.id)] = el;
                    }}
                    to={menuHref}
                    onClick={onClose}
                    className={
                      "relative block rounded-2xl transition-all duration-500 " +
                      (on ? "ring-2 ring-[#FA2851]/45 shadow-md shadow-rose-100" : "")
                    }
                  >
                    <ProductSuggestionCard item={it} onChoose={onChoose} onAdd={onManual} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-gray-500">No suggestions available right now.</div>
          )}
        </SheetScrollArea>

        {/* MIC BAR — part of the column, never over the cards; where the hands-free session runs, the waiter's dock */}
        {voiceBar ? (
        <div className="relative z-40 shrink-0 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100">
          <MicInputBar
            tenant={tenant}
            branch={branch}
            channel="dine-in"
            floorGradient={false}
            shownIds={items.map((i) => String(i.id ?? '')).filter(Boolean)}
            onAiReply={({ replyText, meta }) => {
              const intent = resolveIntent(meta as AiReplyMeta | undefined, replyText);
              onIntent?.(intent, meta as AiReplyMeta | undefined, replyText);
            }}
          />
        </div>
        ) : manual ? (
          // ordering by hand: the tray, like a delivery app — no orb here
          <div className="relative z-40 shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100">
            <button
              type="button"
              onClick={onViewTray}
              disabled={count === 0}
              className="flex h-14 w-full items-center justify-between rounded-2xl bg-[#FA2851] px-5 text-white shadow-[0_6px_18px_rgba(250,40,81,0.35)] active:scale-[0.99] disabled:opacity-50"
            >
              <span className="text-[16px] font-semibold">
                {lang === 'en' ? `View your tray (${count} ${count === 1 ? 'item' : 'items'})` : `ট্রে দেখুন (${count}টি আইটেম)`}
              </span>
              <span className="text-[16px] font-semibold">{formatCurrency(subtotal)}</span>
            </button>
          </div>
        ) : assistant ? (
          assistant
        ) : (
          <div className="shrink-0 h-[max(1rem,env(safe-area-inset-bottom))]" />
        )}

      </div>

      {/* a dish with sizes / add-ons: the same popup as on the menu */}
      {choosing?.full && (
        <Modal
          open={!!choosing}
          onClose={() => setChoosing(null)}
          title={choosing.full.name ?? choosing.name ?? ''}
          image={Array.isArray(choosing.full.media) ? choosing.full.media[0] : choosing.imageUrl}
          images={Array.isArray(choosing.full.media) ? choosing.full.media.filter(Boolean) : choosing.imageUrl ? [choosing.imageUrl] : []}
          price={typeof choosing.full.price === 'number' ? choosing.full.price : choosing.price}
          compareAt={typeof choosing.full.compareAtPrice === 'number' ? choosing.full.compareAtPrice : undefined}
          unavailable={choosing.orderable === false}
          tags={Array.isArray(choosing.full.tags) ? choosing.full.tags : undefined}
          description={typeof choosing.full.description === 'string' ? choosing.full.description : undefined}
          variations={choosing.full.variations}
          options={choosing.full.options}
          modifierGroups={choosing.full.modifierGroups}
          prepMinutes={choosing.full.prepMinutes}
          itemId={choosing.id}
        />
      )}
    </div>
  );
}
