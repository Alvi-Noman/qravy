// apps/tastebud/src/components/ai-waiter/TrayModal.tsx
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { OrderApiError, cartIdempotencyKey, placeOrder, rememberOrder } from '../../api/orders';
import { normalizeTable, useTable } from '../../utils/table';
import {
  missingContactField,
  useFulfillment,
  useGuestContact,
  useOrderChannel,
  type GuestContact,
} from '../../utils/order-mode';
import OnlineOrderDetails, { CONTACT_MESSAGES } from '../OnlineOrderDetails';
import type { Channel } from '../../api/storefront';
import { orderPath } from '../../utils/checkout-flow';
import { getStableSessionId } from '../../utils/ws';
import { tr, uiLang } from '../../utils/ui-lang';
import { useCart, cartLineKey, type CartItem, type CartWarning } from '../../context/CartContext';
import WaitEstimateLine from '../WaitEstimateLine';
import SheetScrollArea, { SHEET_HEIGHT, useBodyScrollLock } from '../SheetScroll';
import { useCartWait } from '../../utils/wait-time';
import { usePublicMenu } from '../../hooks/usePublicMenu';
import { isAvailableAt } from '../../utils/availability';
import LineEditor from './LineEditor';
import { TrayPicks, FlightLayer, type TrayPick, type Flight } from './TrayPicks';
import MicInputBar from './MicInputBar';
import type { AiReplyMeta, WaiterIntent } from '../../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../../utils/intent-routing';

type Props = {
  open: boolean;
  onClose: () => void;
  checkoutHrefOverride?: string;
  recentAiItems?: { id: string; name: string }[];
  upsellItems?: { itemId?: string; id?: string; title: string; price?: number }[];
  /** suggestions the guest asked for while in the tray — shown as "waiter's picks", not as tray lines */
  picks?: TrayPick[];
  /** the waiter asked "which table?" — focus the table field */
  askTable?: boolean;
  /** dine-in (table) or online (pickup/delivery); worked out from the table/restaurant when omitted */
  channel?: Channel;
  /** picks the waiter pointed at when the guest asked about them */
  highlightIds?: string[];
  onIntent?: (intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) => void;
};


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
  recentAiItems = [],
  upsellItems = [],
  picks = [],
  highlightIds = [],
  askTable = false,
  channel: channelProp,
  onIntent,
}: Props) {
  const { items, subtotal, removeLine, addItem, setLineQty, replaceLine, lastChange, warnings, clear } = useCart();

  const storeTenant = typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : undefined;
  const storeBranch = typeof window !== 'undefined' ? (window as any).__STORE__?.branch : undefined;
  const params = useParams<{ subdomain?: string; branchSlug?: string; branch?: string }>();
  const placeSub: string | null = params.subdomain ?? storeTenant ?? null;
  const placeBranch: string | null = params.branchSlug ?? params.branch ?? storeBranch ?? null;
  const autoChannel = useOrderChannel(placeSub);
  const channel: Channel = channelProp ?? autoChannel;
  const { items: menuItems } = usePublicMenu(storeTenant ?? undefined, storeBranch ?? undefined, channel);
  const menuById = React.useMemo(() => {
    const m = new Map<string, any>();
    for (const it of (menuItems as any[]) || []) m.set(String(it.id), it);
    return m;
  }, [menuItems]);

  // what just changed (voice or tap) glows for a moment so the guest sees it happen
  const [justChanged, setJustChanged] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!lastChange) return;
    const keys = new Set<string>([
      ...lastChange.added.map((it) => cartLineKey(it)),
      ...lastChange.changed.map((c) => cartLineKey(c.after)),
    ]);
    setJustChanged(keys);
    const t = window.setTimeout(() => setJustChanged(new Set()), 3500);
    return () => window.clearTimeout(t);
  }, [lastChange]);

  // ---- the tray is the checkout: table (dine-in) or pickup/delivery details (online), note, place the order here
  const lang = uiLang();
  const navigate = useNavigate();
  const [table, saveTable] = useTable(placeSub);
  const [fulfillment, setFulfillment] = useFulfillment(placeSub);
  const [contact, setContact] = useGuestContact(placeSub);
  const [contactFocus, setContactFocus] = React.useState<keyof GuestContact | null>(null);
  const [tableDraft, setTableDraft] = React.useState(table ?? '');
  const [editingTable, setEditingTable] = React.useState(!table);
  const tableInputRef = React.useRef<HTMLInputElement | null>(null);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [orderNote, setOrderNote] = React.useState('');
  const [placing, setPlacing] = React.useState(false);
  const [placeError, setPlaceError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (table) {
      setTableDraft(table);
      setEditingTable(false);
    }
  }, [table]);
  React.useEffect(() => {
    // the waiter asked "which table?" (or, online, for contact details) → put the cursor there
    if (!open || !askTable) return;
    if (channel === 'online') {
      setContactFocus(missingContactField(fulfillment, contact));
      return;
    }
    setEditingTable(true);
    window.setTimeout(() => tableInputRef.current?.focus(), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, askTable, channel]);

  const placeNow = async () => {
    setPlaceError(null);
    setContactFocus(null);
    const online = channel === 'online';
    const t = editingTable ? normalizeTable(tableDraft) : table;
    if (online) {
      const missing = missingContactField(fulfillment, contact);
      if (missing) {
        setContactFocus(missing);
        setPlaceError(CONTACT_MESSAGES[missing]);
        return;
      }
    } else if (!t) {
      setEditingTable(true);
      window.setTimeout(() => tableInputRef.current?.focus(), 50);
      setPlaceError(tr(lang, 'আপনার টেবিল নম্বরটা লিখুন।', 'Please enter your table number.'));
      return;
    }
    if (!placeSub || !items.length) return;
    if (!online && t) saveTable(t);
    setPlacing(true);
    try {
      const sid = getStableSessionId();
      const common = {
        subdomain: placeSub,
        branch: placeBranch,
        items,
        notes: orderNote,
        sessionId: sid,
        idempotencyKey: cartIdempotencyKey(sid, items),
      };
      const { order } = await placeOrder(
        online
          ? { ...common, channel: 'online', fulfillment, customer: contact }
          : { ...common, channel: 'dine-in', table: t as string },
      );
      clear({ silent: true });
      rememberOrder(placeSub, order);
      onClose();
      navigate(orderPath(order.token, placeSub, placeBranch), { state: { justPlaced: true } });
    } catch (e) {
      const err = e as OrderApiError;
      if (err?.needs === 'table') setEditingTable(true);
      if (err?.needs === 'name' || err?.needs === 'phone' || err?.needs === 'address') setContactFocus(err.needs);
      setPlaceError(err?.message || tr(lang, 'অর্ডার দেওয়া যায়নি। আবার চেষ্টা করুন।', "Couldn't place the order. Please try again."));
    } finally {
      setPlacing(false);
    }
  };

  const [autoUpsell, setAutoUpsell] = React.useState(upsellItems);
  React.useEffect(() => {
    if (upsellItems?.length) setAutoUpsell(upsellItems);
  }, [upsellItems]);

  // tap a line → edit it (or pick size/add-ons for a suggestion before it goes in)
  const [editing, setEditing] = React.useState<CartItem | null>(null);
  const [editingIsNew, setEditingIsNew] = React.useState(false);

  // ---- waiter's picks inside the tray, and the fly-in when one is added
  const inTray = new Set(items.map((it) => it.id));
  const shownPicks: TrayPick[] = (
    picks.length
      ? picks
      : (autoUpsell?.length ? autoUpsell : upsellItems).map((u) => ({
          id: String(u.itemId || u.id || ''),
          name: u.title,
          price: u.price,
        }))
  )
    // a pick's job is to get into the tray — once it's there, the tray line shows it (and it flew there)
    .filter((p) => p.id && !inTray.has(p.id))
    .slice(0, 4);
  const pickEls = React.useRef<Record<string, HTMLElement | null>>({});
  const pickRects = React.useRef<Record<string, DOMRect>>({});
  const lineEls = React.useRef<Record<string, HTMLElement | null>>({});
  const [flights, setFlights] = React.useState<Flight[]>([]);
  const flightId = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // tray lines whose card is still in the air — hidden until it lands, so it never lands on a copy of itself
  const [arriving, setArriving] = React.useState<Set<string>>(new Set());
  const measurePicks = React.useCallback(() => {
    // remember where each pick is, so it can fly from there even after it leaves the list
    for (const [id, el] of Object.entries(pickEls.current)) if (el) pickRects.current[id] = el.getBoundingClientRect();
  }, []);
  React.useLayoutEffect(measurePicks); // every render…
  React.useEffect(() => {
    // …and on scroll (scrolling doesn't re-render — the card used to start from where the pick had been)
    const sc = scrollRef.current;
    if (!open || !sc) return;
    sc.addEventListener('scroll', measurePicks, { passive: true });
    window.addEventListener('resize', measurePicks);
    return () => {
      sc.removeEventListener('scroll', measurePicks);
      window.removeEventListener('resize', measurePicks);
    };
  }, [open, measurePicks]);
  React.useLayoutEffect(() => {
    if (!lastChange?.added.length) return;
    const next: Flight[] = [];
    const keys: string[] = [];
    for (const it of lastChange.added) {
      const from = pickRects.current[it.id];
      const key = cartLineKey(it);
      const toEl = lineEls.current[key];
      if (!from || !toEl) continue;
      delete pickRects.current[it.id];
      toEl.scrollIntoView({ block: 'nearest' }); // land where the guest can see it
      next.push({ id: ++flightId.current, name: it.name, imageUrl: it.imageUrl, from, to: toEl.getBoundingClientRect() });
      keys.push(key);
    }
    if (!next.length) return;
    setFlights((f) => [...f, ...next]);
    setArriving((s) => {
      const n = new Set(s);
      keys.forEach((k) => n.add(k));
      return n;
    });
    window.setTimeout(() => {
      // touchdown (the flight is 820ms): the line appears with a small pop
      setArriving((s) => {
        const n = new Set(s);
        keys.forEach((k) => n.delete(k));
        return n;
      });
      for (const k of keys) {
        lineEls.current[k]?.animate(
          [{ transform: 'scale(.94)', opacity: 0.4 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }],
          { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }, // outlasts the line's 500ms opacity transition
        );
      }
    }, 780);
  }, [lastChange]);
  const landFlight = React.useCallback((id: number) => setFlights((f) => f.filter((x) => x.id !== id)), []);

  const addPick = (p: TrayPick) => {
    const m = menuById.get(p.id);
    const needsChoice =
      (Array.isArray(m?.variations) && m.variations.filter((v: any) => v?.name).length > 1) ||
      (Array.isArray(m?.modifierGroups) && m.modifierGroups.some((g: any) => Number(g?.min || 0) > 0));
    const line: CartItem = { id: p.id, name: p.name, price: typeof m?.price === 'number' ? m.price : p.price || 0, qty: 1 };
    if (needsChoice) {
      setEditingIsNew(true); // size / choices first — never add a guess
      setEditing(line);
      return;
    }
    addItem(line);
  };

  /** Sold out / outside serving hours right now — checked on the device too, so taps are covered. */
  const localWarning = (it: CartItem): CartWarning | null => {
    const m = menuById.get(it.id);
    if (!m) return null;
    const soldOut = m.soldOutUntil && new Date(m.soldOutUntil).getTime() > Date.now();
    const outOfHours = Array.isArray(m.availability) && m.availability.length > 0 && !isAvailableAt(m.availability, new Date());
    if (m.available === false || soldOut || outOfHours) {
      return {
        lineKey: cartLineKey(it),
        itemId: it.id,
        name: it.name,
        kind: 'unavailable',
        reason: m.unavailableReason || (soldOut ? 'Sold out right now' : outOfHours ? 'Not served at this time' : 'Not available right now'),
      };
    }
    return null;
  };


  const hasItems = items.length > 0;
  const effectiveOpen = open && hasItems;
  // "Ready in about N min" — only asked while the tray is open
  const wait = useCartWait({ subdomain: placeSub, branch: placeBranch, items: effectiveOpen ? items : [] });

  React.useEffect(() => {
    if (open && !hasItems) onClose?.();
  }, [open, hasItems, onClose]);
  useBodyScrollLock(effectiveOpen);

  React.useEffect(() => {
    if (!effectiveOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [effectiveOpen, onClose]);

  if (!effectiveOpen) return null;

  // the restaurant from the link (/t/<subdomain>/…) like the home screen — the global store value is empty on
  // path links, and a mic without a restaurant sent orders with no restaurant ("Validation failed")
  const tenant = placeSub ?? undefined;
  const branch = placeBranch ?? undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1.5px]"
        onClick={onClose}
      />

      <div
        className={
          `relative z-[101] flex w-full flex-col sm:max-w-md rounded-t-[26px] sm:rounded-3xl bg-[#F8F8F8] ${SHEET_HEIGHT} overflow-hidden sm:shadow-2xl ` +
          "transform transition-all duration-300 ease-out " +
          (open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0")
        }
      >
        <div className="shrink-0 z-20 px-4 pt-3 pb-2 border-b border-gray-100 bg-[#F8F8F8] rounded-t-[26px]">
          <div className="relative flex flex-col items-center">
            <div className="mb-2 h-1 w-12 rounded-full bg-gray-300" />
            <h2 className="text-[15px] font-semibold text-gray-900">
              Your Tray <span className="font-normal text-gray-500">· {items.reduce((n, i) => n + i.qty, 0)}</span>
            </h2>

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

        {/* the list scrolls on its own; the footer below is part of the column, so nothing hides behind it */}
        <SheetScrollArea ref={scrollRef} className="px-4 pt-3 pb-4" moreHint={items.length > 3 ? tr(lang, 'আরও আছে', 'More below') : undefined}>
          <div className="space-y-3">
            {items.map((it) => {
              const key = cartLineKey(it);
              const warn = warnings[key] || localWarning(it);
              const fresh = justChanged.has(key);
              return (
                <div
                  key={key}
                  ref={(el) => (lineEls.current[key] = el)}
                  className={
                    "rounded-2xl p-3 transition-all duration-500 border " +
                    (fresh ? "border-[#FA2851]/50 bg-[#FA2851]/5 ring-2 ring-[#FA2851]/20 " : "border-gray-100 bg-white/40 ") +
                    (warn ? "border-amber-300 " : "") +
                    (arriving.has(key) ? "opacity-0 " : "")
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* tap the line to edit size / add-ons / note */}
                    <button
                      type="button"
                      onClick={() => setEditing(it)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      aria-label={`${it.name}: edit`}
                    >
                      {it.imageUrl ? (
                        <img src={it.imageUrl} alt={it.name} className="h-12 w-12 rounded-xl object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-gray-100" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-gray-900 truncate">{it.name}</div>
                        <div className="text-[12px] text-gray-600 truncate">
                          {it.variation ? `${it.variation} · ` : ''}
                          {formatBDT(it.price)}
                          {it.qty > 1 ? ` · ${formatBDT(it.price * it.qty)}` : ''}
                        </div>
                        {it.modifiers && it.modifiers.length > 0 && (
                          <div className="text-[12px] text-gray-500 line-clamp-2">
                            {it.modifiers.map((m) => (m.price ? `${m.name} (+${formatBDT(m.price)})` : m.name)).join(', ')}
                          </div>
                        )}
                        {it.notes && <div className="text-[12px] text-amber-700 truncate">{it.notes}</div>}
                      </div>
                    </button>

                    {/* − qty + */}
                    <div className="flex items-center rounded-full border border-gray-200 bg-white shrink-0">
                      <button
                        type="button"
                        aria-label="Decrease"
                        onClick={() => (it.qty > 1 ? setLineQty(key, it.qty - 1) : removeLine(key))}
                        className="h-8 w-8 text-lg text-gray-700"
                      >
                        {it.qty > 1 ? '−' : '✕'}
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{it.qty}</span>
                      <button
                        type="button"
                        aria-label="Increase"
                        onClick={() => setLineQty(key, Math.min(50, it.qty + 1))}
                        className="h-8 w-8 text-lg text-gray-700"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {warn && (
                    <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      <span aria-hidden="true">⚠</span>
                      <span className="flex-1">{warn.reason}</span>
                      {warn.kind === 'unavailable' && (
                        <button type="button" onClick={() => removeLine(key)} className="font-semibold underline">
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* table or pickup/delivery details + note — the tray is the checkout; always English */}
          <div className="mt-4 rounded-2xl bg-white px-4 py-3 ring-1 ring-gray-100">
            {channel === 'online' ? (
              <OnlineOrderDetails
                compact
                fulfillment={fulfillment}
                onFulfillment={setFulfillment}
                contact={contact}
                onContact={setContact}
                focusField={contactFocus}
              />
            ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-gray-600">Table</span>
              {!editingTable && table ? (
                <button type="button" onClick={() => setEditingTable(true)} className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
                  {table}
                  <span className="text-[12px] font-medium text-[#FA2851]">Change</span>
                </button>
              ) : (
                <input
                  ref={tableInputRef}
                  value={tableDraft}
                  onChange={(e) => setTableDraft(e.target.value)}
                  onBlur={() => {
                    const t = normalizeTable(tableDraft);
                    if (t) {
                      saveTable(t);
                      setEditingTable(false);
                    }
                  }}
                  maxLength={12}
                  placeholder="e.g. 12"
                  aria-label="Table number"
                  className="w-24 rounded-xl border border-gray-200 px-3 py-1.5 text-right text-[15px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40"
                />
              )}
            </div>
            )}
            {noteOpen ? (
              <input
                autoFocus
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                maxLength={300}
                placeholder="Note for the kitchen — e.g. everything less spicy"
                className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#FA2851]/40"
              />
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="mt-2 text-[12px] font-medium text-gray-500 hover:text-gray-800">
                + Note for the kitchen
              </button>
            )}
            {channel !== 'online' && <p className="mt-2 text-[11px] text-gray-400">You pay at the counter</p>}
          </div>

          <TrayPicks
            picks={shownPicks}
            onAdd={addPick}
            registerRef={(id, el) => (pickEls.current[id] = el)}
            highlightIds={highlightIds}
          />
        </SheetScrollArea>

        {/* BOTTOM BAR: place the order + the mic — always visible, never over the list */}
        <div className="relative z-40 shrink-0 border-t border-gray-200 bg-[#F8F8F8] px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3">
          {placeError && (
            <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {placeError}
            </div>
          )}
          <WaitEstimateLine estimate={wait} lang={lang} className="justify-center" />
          <button
            type="button"
            onClick={placeNow}
            disabled={placing}
            className="relative z-[60] flex w-full items-center justify-between rounded-2xl bg-[#FA2851] px-4 py-3.5 text-white font-semibold shadow-lg shadow-rose-200 active:scale-[0.99] disabled:opacity-70"
          >
            <span>{placing ? tr(lang, 'অর্ডার দেওয়া হচ্ছে…', 'Placing…') : tr(lang, 'অর্ডার দিন', 'Place order')}</span>
            <span>{formatBDT(subtotal)}</span>
          </button>
          <MicInputBar
            tenant={tenant}
            branch={branch}
            channel={channel}
            floorGradient={false}
            panelLift={64}
            shownIds={shownPicks.map((p) => p.id)}
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

      <LineEditor
        line={editing}
        menuItem={editing ? menuById.get(editing.id) : undefined}
        onClose={() => {
          setEditing(null);
          setEditingIsNew(false);
        }}
        onRemove={() => {
          if (editing && !editingIsNew) removeLine(cartLineKey(editing));
          setEditing(null);
          setEditingIsNew(false);
        }}
        onSave={(next) => {
          if (editing && editingIsNew) addItem(next);
          else if (editing) replaceLine(cartLineKey(editing), next);
          setEditing(null);
          setEditingIsNew(false);
        }}
      />
      <FlightLayer flights={flights} onDone={landFlight} />
    </div>
  );
}
