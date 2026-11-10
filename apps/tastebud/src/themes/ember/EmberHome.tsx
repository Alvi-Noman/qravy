// apps/tastebud/src/themes/ember/EmberHome.tsx
// Ember — the waiter's home (dine-in table or online shop). One screen, by what's happening:
//   1.1 Launch (logo, table, "Get started" — that tap unlocks the voice) · 1.2 Home (greeting + ✦ Suggested for you)
//   2.1 Listening · 2.2 Thinking · 2.3 Suggesting (carousel) · 2.4 Added (− 1 + and the pairing)
//   3.x Your order with ghost suggestions (added by voice) · 7.1 live order status · 8 Call waiter · 9.1 online home
// The waiter is the shared one (src/waiter/useWaiterSession) — this page only shows it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWaiterSession, markWelcomeInteraction, WELCOME_INTERACT_KEY, WELCOME_INACTIVITY_MS } from '../../waiter/useWaiterSession';
import { useCart, cartLineKey, type CartItem } from '../../context/CartContext';
import { usePublicMenu } from '../../hooks/usePublicMenu';
import { ownMessage, type GuestMessages } from '../../utils/guestMessages';
import { welcomeText } from '../../utils/welcome';
import { orderPath } from '../../utils/checkout-flow';
import { money } from '../../utils/ui-lang';
import { track } from '../../utils/track';
import { useEmberChrome } from './Chrome';
import Carousel from './Carousel';
import { sayingIndex } from './captions';
import { WaitingDish } from './WaitingDish';
import { FLY_MS, GhostFlights, type GhostFlightT } from './GhostFlight';
import type { PickOption } from '../../utils/handsfree';
import { clockTime, useOrderClock, useStoreRoute } from './store';
import { useVisit, useVisitSync } from './visit';
import { MomentCard, useMoment } from './Moments';
import {
  AddControl, BottomBar, DishSheet, EM, I, LiveStatusBar, Orb, OrderBar, QuickReplies, ScrollDown, Shell, SuggestedForYou,
  TopBar, Caption, CaptionWindow, captionSpans, useLiveHeard, lineWarning, LineWarning, greeting, haptic, imageOf, needsChoices, priceOf, tx, type Chip, type Glow, type Lang,
} from './ui';


/** The last sentence of what Pixie said — the question the guest is answering. */
const lastSentence = (s: string) => {
  const parts = s.trim().split(/(?<=[.!?।])\s+/);
  return parts[parts.length - 1] || s;
};

/* ---------------------------------------------------------------- 1.1 Launch */
function Launch({ name, logo, table, lang, onLang, onStart }: { name?: string; logo?: string | null; table: string | null; lang: Lang; onLang: () => void; onStart: () => void }) {
  return (
    <div className="em-fade absolute inset-0 z-[150] flex flex-col overflow-hidden" style={{ background: EM.bg }}>
      <div aria-hidden="true" className="absolute left-1/2 top-[160px] h-[420px] w-[510px] -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(245,165,36,0.16), rgba(245,165,36,0) 100%)' }} />
      <div className="relative flex flex-1 flex-col items-center justify-center gap-[22px] pb-10">
        <div className="flex h-[136px] w-[136px] items-center justify-center overflow-hidden rounded-[36px]" style={{ background: EM.chip, border: `1px solid ${EM.chipLine}` }}>
          {logo ? (
            <img src={logo} alt={name || ''} className="h-full w-full object-contain p-3" />
          ) : (
            <span className="em-tight px-3 text-center text-[22px] font-semibold" style={{ color: EM.text2 }}>{name || ''}</span>
          )}
        </div>
        {name && logo && <span className="em-tight text-[20px] font-semibold">{name}</span>}
        {table && <span className="text-[15px]" style={{ color: EM.text3 }}>{tx(lang, `টেবিল ${table}`, `Table ${table}`)}</span>}
      </div>
      <div className="relative flex flex-col gap-4 px-6 pb-[calc(env(safe-area-inset-bottom,0px)+40px)]">
        <p className="text-center text-[14px] leading-[1.45]" style={{ color: EM.text3 }}>
          {tx(lang, 'ওয়েটারের সাথে কথা বলে অর্ডার করুন, বা মেনু দেখুন। মাইক্রোফোন ব্যবহারের অনুমতি চাওয়া হবে।', "Order by talking to your waiter, or browse the menu. We'll ask to use your microphone.")}
        </p>
        <button type="button" onClick={onStart} className="h-[60px] rounded-full text-[17px] font-semibold active:scale-[0.99]" style={{ background: EM.amber, color: EM.bg }}>
          {tx(lang, 'শুরু করুন', 'Get started')}
        </button>
        <button type="button" aria-label="Change language" onClick={onLang} className="flex h-11 items-center gap-1.5 self-center px-3.5 text-[14px] font-medium" style={{ color: EM.text2 }}>
          {I.globe()}
          {lang === 'en' ? 'English' : 'বাংলা'}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- 2.3 suggestion card */
function SuggestionCard({
  s,
  hero,
  lang,
  onChoose,
  onAdded,
  marked,
}: {
  s: any;
  hero: boolean;
  lang: Lang;
  onChoose: (item: any) => void;
  onAdded: () => void;
  /** the dish Pixie pointed at ("which of these is regular?") — ringed, as in the original theme */
  marked?: boolean;
}) {
  const full = s.full ?? {};
  const id = String(s.id ?? full.id ?? '');
  const name = String(s.name ?? full.name ?? '');
  const price = typeof s.price === 'number' ? s.price : priceOf(full);
  const img = s.imageUrl || imageOf(full);
  const tag = full.signature ? tx(lang, 'শেফের পছন্দ', "CHEF'S PICK") : Array.isArray(full.tags) && full.tags[0] ? String(full.tags[0]).toUpperCase() : '';
  const desc = String(full.description ?? '').trim();
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={name}
      // a tap on the card opens the dish (its photo, sizes, add-ons) — as in the original theme
      onClick={() => s.full && onChoose(full.id ? full : { ...s, id })}
      className="shrink-0 cursor-pointer snap-start overflow-hidden rounded-[28px] transition-[border-color,box-shadow] duration-500"
      style={{
        width: hero ? 300 : 260,
        background: '#161412',
        border: marked ? `1.5px solid ${EM.amber}` : '1px solid #2A2622',
        boxShadow: marked ? '0 0 0 4px rgba(245,165,36,0.14), 0 18px 40px rgba(245,165,36,0.12)' : 'none',
      }}
    >
      <div className="relative flex items-center justify-center text-[13px]" style={{ height: hero ? 200 : 176, background: '#2A1F12', color: '#8F8A84' }}>
        {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : tx(lang, 'ছবি নেই', 'No photo')}
        {id && (
          <span onClick={(e) => e.stopPropagation()}>
          <AddControl
            item={{ id, name, price, imageUrl: img, choices: !!s.choices }}
            disabled={s.orderable === false}
            onChoose={() => onChoose(full.id ? full : { ...s, id })}
            onAdded={onAdded}
          />
          </span>
        )}
      </div>
      <div className={`flex flex-col gap-1.5 ${hero ? 'px-5 pb-5 pt-[18px]' : 'px-[18px] pb-[18px] pt-4'}`}>
        {tag && (
          <span className="truncate text-[11px] font-semibold tracking-[0.8px]" style={{ color: full.signature ? EM.amber : '#CFCAC4' }}>
            {tag}
          </span>
        )}
        <span className={`em-tight truncate font-semibold ${hero ? 'text-[21px]' : 'text-[19px]'}`}>{name}</span>
        {desc && <span className="truncate text-[14px]" style={{ color: '#8F8A84' }}>{desc}</span>}
        <span className="mt-1 text-[16px] font-semibold">{money(price)}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------- 3.x your order + ghost items */
function OrderCard({
  lang,
  ghosts,
  talkingAbout,
  justAdded,
  onAddGhost,
  onDismiss,
  waiting,
  imageFor,
  onAnswer,
  marked,
  menuById,
  onEdit,
}: {
  lang: Lang;
  ghosts: { id: string; name: string; price: number; reason: string }[];
  talkingAbout: string | null;
  justAdded: Set<string>;
  onAddGhost: (id: string) => void;
  onDismiss: (id: string) => void;
  /** dishes the waiter holds until the guest picks a size / choice — shown in the order, not yet in it */
  waiting: PickOption[];
  imageFor: (id: string) => string | undefined;
  onAnswer: (say: string) => void;
  /** suggestions Pixie pointed at ("which of these…") — ringed */
  marked: Set<string>;
  menuById: Map<string, any>;
  /** a line tapped → change its size / choices / qty */
  onEdit: (line: CartItem) => void;
}) {
  const { items, subtotal, lastChange, warnings, removeLine } = useCart();

  // a suggestion that gets into the order flies from its spot into its new line (as in the original theme's tray):
  // where each ghost is gets remembered on every render and scroll, so it can fly from there after it has left
  const ghostEls = useRef<Record<string, HTMLElement | null>>({});
  const ghostRects = useRef<Record<string, DOMRect>>({});
  const lineEls = useRef<Record<string, HTMLElement | null>>({});
  const [flights, setFlights] = useState<GhostFlightT[]>([]);
  const flightId = useRef(0);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const measure = useCallback(() => {
    for (const [id, el] of Object.entries(ghostEls.current)) if (el) ghostRects.current[id] = el.getBoundingClientRect();
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  }, [measure]);
  useLayoutEffect(() => {
    if (!lastChange?.added.length) return;
    const next: GhostFlightT[] = [];
    const keys: string[] = [];
    for (const it of lastChange.added) {
      const from = ghostRects.current[it.id];
      const key = cartLineKey(it);
      const toEl = lineEls.current[key];
      if (!from || !toEl) continue;
      delete ghostRects.current[it.id];
      toEl.scrollIntoView({ block: 'nearest' });
      next.push({ id: ++flightId.current, name: it.name, imageUrl: it.imageUrl, from, to: toEl.getBoundingClientRect() });
      keys.push(key);
    }
    if (!next.length) return;
    setFlights((x) => [...x, ...next]);
    setArriving((a) => new Set([...Array.from(a), ...keys]));
    const t = window.setTimeout(() => {
      // touchdown: the line appears with a small pop
      setArriving((a) => new Set(Array.from(a).filter((k) => !keys.includes(k))));
      for (const k of keys)
        lineEls.current[k]?.animate(
          [{ transform: 'scale(.94)', opacity: 0.4 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }],
          { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
    }, FLY_MS - 40);
    return () => window.clearTimeout(t);
  }, [lastChange]);
  const landed = useCallback((id: number) => setFlights((x) => x.filter((f) => f.id !== id)), []);

  return (
    <div className="flex flex-col gap-3 rounded-[20px] px-[18px] py-4" style={{ background: EM.surface, border: `1px solid ${EM.border}` }}>
      <span className="text-[12px] font-semibold tracking-[1px]" style={{ color: EM.text3 }}>{tx(lang, 'আপনার অর্ডার', 'YOUR ORDER')}</span>
      {items.map((l) => {
        const key = cartLineKey(l);
        const isNew = justAdded.has(key);
        const warn = lineWarning(l, menuById.get(l.id), warnings, lang);
        const extras = [l.variation, ...(l.modifiers ?? []).map((m) => m.name)].filter(Boolean).join(', ');
        return (
          <div key={key} ref={(el) => (lineEls.current[key] = el)} className="transition-opacity duration-500" style={{ opacity: arriving.has(key) ? 0 : 1 }}>
          <button
            type="button"
            onClick={() => onEdit(l)}
            aria-label={tx(lang, `${l.name} বদলান`, `Change ${l.name}`)}
            className="flex min-h-[28px] w-full items-center gap-2.5 text-left text-[15px]"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: EM.amber, color: EM.bg }}>
              {I.check({ size: 11, sw: 3.2 })}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">
                {l.qty} × {l.name}
                {extras && <span style={{ color: EM.muted }}> · {extras}</span>}
              </span>
              {isNew && <span className="text-[10px] font-bold tracking-[0.6px]" style={{ color: EM.amber }}>{tx(lang, 'এইমাত্র যোগ হলো', 'JUST ADDED')}</span>}
            </span>
            <span style={{ color: EM.text2 }}>{money(l.price * l.qty)}</span>
          </button>
          {warn && <LineWarning text={warn} lang={lang} onRemove={() => removeLine(key)} />}
          </div>
        );
      })}
      {waiting.map((p) => (
        <WaitingDish key={p.itemId} p={p} lang={lang} image={imageFor(p.itemId)} onAnswer={onAnswer} />
      ))}
      {ghosts.length > 0 && (
        <>
          <div className="mt-2.5 h-px" style={{ background: 'repeating-linear-gradient(90deg, #3A3A3F 0 6px, rgba(0,0,0,0) 6px 12px)' }} />
          <span className="mt-2 text-[11px] font-semibold tracking-[1px]" style={{ color: EM.muted }}>
            {tx(lang, 'পরামর্শ · এখনো অর্ডারে নেই', 'SUGGESTED · NOT IN YOUR ORDER YET')}
          </span>
          {ghosts.map((g) => (
            <div
              key={g.id}
              ref={(el) => (ghostEls.current[g.id] = el)}
              className="em-fade -mx-2 flex items-center gap-2.5 rounded-[14px] py-2 pl-2 pr-1.5"
              style={{
                border: `1.5px dashed ${talkingAbout === g.id || marked.has(g.id) ? EM.amber : '#55555B'}`,
                background: marked.has(g.id) ? 'rgba(245,165,36,0.06)' : 'transparent',
              }}
            >
              <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full" style={{ border: `1.5px dashed ${EM.muted}` }} />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[15px]" style={{ color: '#C7C7CC' }}>{g.name}</span>
                <span className="truncate text-[12px]" style={{ color: EM.muted }}>
                  {g.reason ? `${g.reason} · ` : ''}+{money(g.price)}
                </span>
              </span>
              <button type="button" aria-label={`Dismiss ${g.name}`} onClick={() => onDismiss(g.id)} className="flex h-11 w-9 shrink-0 items-center justify-center" style={{ color: EM.muted }}>
                {I.x()}
              </button>
              <button type="button" aria-label={`Add ${g.name}`} onClick={() => onAddGhost(g.id)} className="h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold" style={{ background: EM.text, color: EM.bg }}>
                {tx(lang, 'যোগ', 'Add')}
              </button>
            </div>
          ))}
        </>
      )}
      {items.length > 0 && <div className="mt-0.5 h-px" style={{ background: EM.border }} />}
      <GhostFlights flights={flights} onDone={landed} />
      {items.length > 0 && <div className="flex items-baseline justify-between">
        <span className="text-[15px]" style={{ color: EM.text2 }}>{tx(lang, 'মোট', 'Total')}</span>
        <span className="text-[17px] font-semibold">{money(subtotal)}</span>
      </div>}
    </div>
  );
}

/* ======================================================================== */
export default function EmberHome() {
  const navigate = useNavigate();
  const route = useStoreRoute();
  const { sub, branch, channel, online, table, info, waiterName } = route;

  // the start screen again after 10 minutes away (the same rule as the original theme)
  const [started, setStarted] = useState(() => {
    try {
      const last = parseInt(localStorage.getItem(WELCOME_INTERACT_KEY) || '', 10);
      return Number.isFinite(last) && Date.now() - last < WELCOME_INACTIVITY_MS;
    } catch {
      return false;
    }
  });

  const w = useWaiterSession({
    subdomain: sub,
    branch: branch ?? undefined,
    channel,
    onOpenMenu: () => navigate(route.menuHref()),
    // the read-back / "which table?" / details step → the order page (it is the checkout)
    onCheckoutStep: () => navigate(route.checkoutHref),
  });
  const { orbMode, aiLive, aiFinal, aiAt, listening, uiMode, welcomePending, setWelcomePending, tts } = w;
  const lang: Lang = w.selectedLang === 'en' ? 'en' : 'bn';
  const { items: cartItems, count, subtotal, addItem, lastChange } = useCart();
  const { items: menu } = usePublicMenu(sub, branch ?? undefined, channel);
  const menuById = useMemo(() => new Map(menu.map((m: any) => [String(m.id), m])), [menu]);
  const { active, all: recent } = useVisitSync(sub);
  const visit = useVisit();
  const liveOrder = active[0] ?? null;
  const clock = useOrderClock(liveOrder);

  // the conversation starters — the owner's, as on the original home screen (the second opens the menu)
  const starters = lang === 'en' ? ['What can I eat now?', 'Show me the menu'] : ['এখন কী খেতে পারি?', 'মেনু দেখতে চাই'];
  const chrome = useEmberChrome({ w, route, chatChips: starters });
  const starterChips = starters.map((s, i) => ({ label: s, onClick: () => (i === 1 ? navigate(route.menuHref()) : chrome.say(s)) }));

  // the restaurant's own welcome (Settings → Guest messages), else the original default — never new wording
  const welcome =
    ownMessage((info as { guestMessages?: GuestMessages } | null)?.guestMessages, 'welcome', lang, { restaurant: info?.name, waiter: waiterName }) ??
    welcomeText(lang, info?.name, waiterName);

  /* ---------- what's happening */
  const thinking = orbMode === 'thinking' || uiMode === 'thinking';
  const talking = orbMode === 'talking';
  // suggestion cards or the order (with its upsell ghosts): whichever the conversation brought LAST. New cards →
  // the slider; a reply that changed the order → the order view, and the older cards are put away. ("+" tapped on a
  // card changes the order too, but it is not a reply — the cards stay while the guest taps through them.)
  const cardsKey = w.showSuggestions ? w.suggestedItems.map((x: any) => String(x.id ?? x.name)).join(',') : '';
  const [cardsAt, setCardsAt] = useState(0);
  const [orderAt, setOrderAt] = useState(0);
  useEffect(() => {
    if (cardsKey) setCardsAt(Date.now());
  }, [cardsKey]);
  useEffect(() => {
    if (w.showTray) setOrderAt(Date.now());
  }, [w.showTray]);
  // a dish waiting for its size / choice belongs to the order view too (the waiting row is in YOUR ORDER)
  const holdKey = w.pickOptions.map((p) => p.itemId).join(",");
  useEffect(() => {
    if (holdKey) setOrderAt(Date.now());
  }, [holdKey]);
  const hasOrder = (w.showTray && cartItems.length > 0) || w.pickOptions.length > 0;
  // when the guest started this turn (talking or a typed / tapped message) — only order changes after it count
  const turnStartRef = useRef(0);
  const turnOn = w.listening || w.orbMode === 'thinking';
  useEffect(() => {
    if (turnOn) turnStartRef.current = Date.now();
  }, [turnOn]);
  // a reply that came with an order change (the waiter added / removed something in this turn)
  useEffect(() => {
    if (!w.showTray || !lastChange || !turnStartRef.current) return;
    if (lastChange.at >= turnStartRef.current - 500) setOrderAt(Date.now());
    // (on each new reply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.aiAt]);
  const orderIsNewer = hasOrder && orderAt > cardsAt;
  useEffect(() => {
    if (orderIsNewer && w.showSuggestions) {
      w.setShowSuggestions(false);
      w.setHighlightIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIsNewer]);
  const suggesting = w.showSuggestions && w.suggestedItems.length > 0 && !orderIsNewer;
  const ordering = hasOrder && !suggesting;
  const fresh = Date.now() - aiAt < 3 * 60_000; // a reply from long ago isn't the line you come back to
  const said = (aiLive || (welcomePending ? '' : fresh ? aiFinal : '') || '').trim();
  const typedLast = [...chrome.log].reverse().find((m) => m.who === 'guest' && Date.now() - m.at < 3 * 60_000)?.text ?? '';
  // what the guest said last: the real transcript of their voice (or what they typed)
  const lastGuest = (w.heard && Date.now() - w.heardAt < 3 * 60_000 ? w.heard : '') || typedLast;
  // the guest's words while they talk: confirmed ones white, the newest guess grey
  const liveSpans = useLiveHeard(listening ? w.heardLive : '');
  // Pixie's words: said ones white, still-to-come dimmed, the menu's dish names amber
  const dishNames = useMemo(() => menu.map((m: any) => String(m.name || '')), [menu]);
  const speakingNow = talking && !!w.sayingText;
  const captionOf = (text: string, dim?: string) =>
    captionSpans({ text: speakingNow ? w.sayingText : text, spoken: speakingNow ? aiLive || '' : null, dishes: dishNames, dim });

  /* ---------- ghost items (max 2, never what's in the order, never one the guest said no to) */
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(`qravy:ember:no:${sub}`) || '[]'));
    } catch {
      return new Set();
    }
  });
  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    try {
      sessionStorage.setItem(`qravy:ember:no:${sub}`, JSON.stringify(Array.from(next)));
    } catch {
      /* storage blocked */
    }
  };
  const metaUpsell = (w.lastMeta as any)?.upsell?.length ? w.mapUpsell((w.lastMeta as any).upsell) : [];
  const upsell = metaUpsell.length ? metaUpsell : w.trayPicks.length ? w.trayPicks : w.upsellItems;
  const inCart = new Set(cartItems.map((c) => c.id));
  const ghosts = (upsell as any[])
    .map((u) => {
      const id = String(u.itemId ?? u.id ?? '');
      const m: any = menuById.get(id);
      const reason = String(u.reason ?? m?.description ?? '').split(/[.,;]/)[0].trim().slice(0, 28);
      return { id, name: String(u.title ?? u.name ?? m?.name ?? ''), price: typeof u.price === 'number' ? u.price : priceOf(m), reason };
    })
    // never what's in the order — in the cart, or ordered earlier this visit — nor one the guest said no to
    .filter((g) => g.id && g.name && !inCart.has(g.id) && !visit.ordered[g.id] && !dismissed.has(g.id))
    .slice(0, 2);
  const talkingAbout = w.offerItemIds.find((id) => ghosts.some((g) => g.id === id)) ?? (ghosts.length ? ghosts[0].id : null);

  /* ---------- the slider: Pixie's pick, and the card whose name she is saying */
  const marked = useMemo(() => new Set(w.highlightIds.map(String)), [w.highlightIds]);
  const markedIndex = (() => {
    const i = w.suggestedItems.findIndex((s: any) => marked.has(String(s.id)));
    return i >= 0 ? i : null;
  })();
  // each card's name as the voice says it (the waiter sends the Bangla-script form; English: the menu name)
  const dishSaid: Array<{ id: string; said: string }> = Array.isArray((w.lastMeta as any)?.dishSaid) ? (w.lastMeta as any).dishSaid : [];
  const saidWords = speakingNow ? (aiLive || '').trim().split(/\s+/).filter(Boolean).length : 0;
  const sayingIdx = useMemo(
    () => (suggesting && speakingNow ? sayingIndex(w.sayingText, saidWords, w.suggestedItems, dishSaid) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggesting, speakingNow, saidWords, w.sayingText, w.suggestedItems, dishSaid.length],
  );
  const [focus, setFocus] = useState<{ i: number; n: number }>({ i: 0, n: 0 });
  const moveTo = useCallback((i: number) => setFocus((f) => ({ i, n: f.n + 1 })), []);
  const guestMovedRef = useRef(false); // the guest swiped while she talked → leave the slider to them
  const followedRef = useRef(false);
  useEffect(() => {
    guestMovedRef.current = false; // each new line she says follows again
  }, [w.sayingText]);
  useEffect(() => {
    if (sayingIdx == null || guestMovedRef.current) return;
    followedRef.current = true;
    moveTo(sayingIdx);
  }, [sayingIdx, moveTo]);
  // she has finished → back to the first card (or the one she pointed at)
  useEffect(() => {
    if (speakingNow || !followedRef.current) return;
    followedRef.current = false;
    if (guestMovedRef.current) return;
    const t = window.setTimeout(() => moveTo(markedIndex ?? 0), 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakingNow]);
  // "which of these is regular?" → that card slides in and is ringed (as in the original theme)
  const markedKey = w.highlightIds.join(',');
  useEffect(() => {
    if (markedIndex != null) moveTo(markedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markedKey]);
  const [editLine, setEditLine] = useState<CartItem | null>(null);
  // the suggestions in the order, in order: "the first one" is the first one HERE — the waiter is told which
  const ghostKey = ghosts.map((g) => g.id).join(',');
  useEffect(() => {
    w.setShownOnScreen(ordering && ghostKey ? ghostKey.split(',') : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordering, ghostKey]);
  useEffect(() => () => w.setShownOnScreen(null), []); // (leaving the page)
  // the right card at the right moment of the visit (Moments.tsx): the same drinks again, something sweet, last order
  const { moment, dismiss: dismissMoment } = useMoment({
    sub, branch: branch ?? null, online, visit, menuById, cartEmpty: count === 0, hasActiveOrder: active.length > 0,
  });

  // "JUST ADDED": the lines this visit's latest change put in
  const justAdded = useMemo(() => new Set((lastChange?.added ?? []).map((l) => cartLineKey(l))), [lastChange]);
  const [dish, setDish] = useState<any | null>(null);
  const addGhost = (id: string) => {
    // the waiter's offer: "yes" adds exactly what was offered (its size too), and counts as a yes (as in the tray)
    if (w.offerItemIds.includes(id)) return chrome.say(lang === 'en' ? 'yes' : 'হ্যাঁ');
    const m: any = menuById.get(id);
    if (!m) return;
    if (needsChoices(m)) return setDish(m);
    haptic();
    addItem({ id, name: m.name, price: priceOf(m), ...(imageOf(m) ? { imageUrl: imageOf(m) } : {}) });
  };

  /* ---------- 1.1 → the first tap unlocks the voice, then the welcome is spoken */
  const start = () => {
    setStarted(true);
    track('waiter_start');
    tts.unlock();
    markWelcomeInteraction();
    void w.askMicAccess();
    setWelcomePending(true);
    try {
      tts.stop();
    } catch {
      /* nothing playing */
    }
    tts.speak(welcome).catch(() => setWelcomePending(false));
  };

  /* ---------- quick replies: the waiter's own answers first */
  const chips: Chip[] = [];
  if (!listening && !thinking) {
    if (w.choices.length) w.choices.forEach((c) => chips.push({ label: c.label, onClick: () => chrome.say(c.say) }));
    // (a dish waiting for its size / choice: its pills are in the order card, not down here)
    else if (ordering && !talking && !w.pickOptions.length) {
      chips.push({ label: online ? tx(lang, 'চেকআউট', 'Checkout') : tx(lang, 'কিচেনে পাঠান', 'Send to kitchen'), primary: true, onClick: () => navigate(route.checkoutHref) });
      chips.push({ label: tx(lang, 'আরও যোগ করুন', 'Add more'), onClick: () => navigate(route.menuHref()) });
    }
  }
  const asked = /[?？]\s*$/.test(said) || chips.length > 0;
  const orbLabel = listening
    ? tx(lang, 'শুনছি', 'Listening')
    : thinking
    ? tx(lang, 'ভাবছি', 'Thinking')
    : talking
    ? tx(lang, 'থামাতে ট্যাপ করুন', 'Tap to interrupt')
    : asked && started
    ? tx(lang, 'উত্তর দিতে ট্যাপ করুন', 'Tap to reply')
    : tx(lang, 'কথা বলতে ট্যাপ করুন', 'Tap to talk');
  const glow: Glow = listening ? 'listen' : thinking ? 'think' : suggesting || talking ? 'speak' : 'calm';

  /* ---------- bars above the bottom bar */
  const orderBar =
    count > 0 && (suggesting || ordering) ? (
      <OrderBar label={`${tx(lang, 'অর্ডার দেখুন', 'View order')} · ${money(subtotal)}`} count={count} onClick={() => navigate(route.checkoutHref)} />
    ) : null;
  const liveBar =
    liveOrder && !suggesting && !ordering ? (
      <LiveStatusBar
        lang={lang}
        minutes={clock.minutes}
        fraction={clock.fraction}
        onClick={() => navigate(orderPath(liveOrder.token, sub, branch))}
        title={
          liveOrder.status === 'placed'
            ? tx(lang, 'অনুমোদনের অপেক্ষায়', 'Waiting for approval')
            : liveOrder.status === 'ready'
            ? tx(lang, 'প্রস্তুত!', 'Ready!')
            : `${tx(lang, 'রান্না হচ্ছে', 'Cooking')}${clock.readyAt ? ` · ${tx(lang, 'প্রস্তুত', 'ready')} ~${clockTime(clock.readyAt)}` : ''}`
        }
        sub={`${clock.minutes != null ? (clock.overdue ? tx(lang, 'প্রায় হয়ে এসেছে', 'Almost ready') : tx(lang, `${clock.minutes} মিনিট বাকি`, `${clock.minutes} min left`)) + ' · ' : ''}${liveOrder.items.reduce((n, i) => n + i.qty, 0)} ${tx(lang, 'আইটেম', 'items')}`}
      />
    ) : null;
  const homeIdle = !listening && !thinking && !suggesting && !ordering && !talking;

  const scroller = useRef<HTMLDivElement>(null);
  // a new turn scrolls the conversation to its end
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [aiAt, count]);

  const seeAllPicks = useCallback(() => navigate(route.menuHref('#for-you')), [navigate, route]);

  /* ---------- the middle of the screen */
  let middle: React.ReactNode;
  // the text above the cards / the order while the guest talks or Pixie thinks: the cards stay where they are (the
  // guest is talking about them — "add that one", "the second one"); only these words change
  const turnText = (size: 'carousel' | 'order') => {
    const big = size === 'carousel' ? 'text-[25px] leading-[1.22] tracking-[-0.4px]' : 'text-[26px] leading-[1.2] tracking-[-0.4px]';
    const lh = size === 'carousel' ? 25 * 1.22 : 26 * 1.2;
    // the guest's own words, grey and quoted above Pixie's (as in the design)
    const guestLine = lastGuest ? (
      <p className="em-tight line-clamp-2 text-[17px] leading-[1.35]" style={{ color: EM.muted }}>“{lastGuest}”</p>
    ) : null;
    if (listening)
      return liveSpans.length ? (
        <CaptionWindow lines={3} lineHeight={lh}>
          <Caption spans={liveSpans} className={`em-tight font-medium ${big}`} />
        </CaptionWindow>
      ) : (
        <p className={`em-tight font-medium ${big}`} style={{ color: EM.muted }}>{tx(lang, 'বলুন, শুনছি…', 'Go ahead, I’m listening…')}</p>
      );
    if (thinking)
      return (
        <div className="flex flex-col gap-2">
          {guestLine}
          <p className={`em-tight font-medium ${big}`} style={{ color: EM.text2 }}>{aiLive || tx(lang, 'ভাবছি…', 'Let me think…')}</p>
        </div>
      );
    if (!said && !guestLine) return null;
    // a long reply never grows past 3 lines: the newest words in view, older ones fade out above; a tap shows it all
    return (
      <div className="flex flex-col gap-2">
        {guestLine}
        {said && (
          <CaptionWindow lines={3} lineHeight={lh} onOpen={chrome.openChat} label={tx(lang, 'পুরো উত্তর দেখুন', 'Read the full reply')}>
            <Caption spans={captionOf(said)} className={`em-tight font-medium ${big}`} />
          </CaptionWindow>
        )}
      </div>
    );
  };

  if (suggesting) {
    // 2.3 / 2.4 — the words above, the slider below: card to card, the next one peeking
    middle = (
      <div className="em-fade flex min-h-0 flex-1 flex-col">
        <div key={listening ? 'l' : thinking ? 't' : 's'} className="em-fade shrink-0 px-7 pt-3">{turnText('carousel')}</div>
        <div className="flex min-h-0 flex-1 items-center">
          <Carousel
            label={tx(lang, 'পিক্সির পরামর্শ', 'Suggestions')}
            focusIndex={focus.n ? focus.i : null}
            focusKey={focus.n}
            onUserMove={() => (guestMovedRef.current = true)}
            resetKey={w.suggestedItems.map((s: any) => String(s.id ?? s.name)).join(',')}
          >
            {w.suggestedItems.map((s: any, i: number) => (
              <SuggestionCard key={String(s.id ?? i)} s={s} hero lang={lang} marked={marked.has(String(s.id))} onChoose={setDish} onAdded={() => w.setManualOrder(true)} />
            ))}
          </Carousel>
        </div>
        {count === 0 && !listening && !thinking && (
          <p className="shrink-0 pb-3 text-center text-[15px]" style={{ color: '#CFCAC4' }}>
            {tx(lang, '“ওটা যোগ করুন” বলুন, অথবা + ট্যাপ করুন।', 'Say “add that one”, or tap +.')}
          </p>
        )}
      </div>
    );
  } else if (ordering) {
    // 3.1 – 3.3 — the conversation and YOUR ORDER with ghost suggestions; the middle scrolls
    middle = (
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="em-noscroll h-full overflow-y-auto">
          <div className="flex flex-col gap-[22px] px-6 pb-6 pt-2">
            <div key={listening ? 'l' : thinking ? 't' : 's'} className="em-fade mx-1">{turnText('order')}</div>
            <OrderCard
              lang={lang}
              ghosts={ghosts}
              talkingAbout={talkingAbout}
              justAdded={justAdded}
              onAddGhost={addGhost}
              onDismiss={dismiss}
              waiting={w.pickOptions}
              imageFor={(id) => imageOf(menuById.get(id))}
              marked={marked}
              menuById={menuById}
              onEdit={setEditLine}
              onAnswer={chrome.say}
            />
          </div>
        </div>
        <ScrollDown scroller={scroller} />
      </div>
    );
  } else if (listening) {
    // 2.1 — nothing else on screen: Pixie's question small above; the guest's words big below as they talk
    middle = (
      <div className="em-fade flex flex-col gap-10 px-7 pt-3">
        <p className="em-tight text-[18px] leading-[1.35]" style={{ color: EM.muted }}>{lastSentence(said || welcome)}</p>
        {liveSpans.length ? (
          <Caption spans={liveSpans} className="em-tight text-[38px] font-medium leading-[1.12] tracking-[-0.9px]" />
        ) : (
          <p className="em-tight text-[38px] font-medium leading-[1.12] tracking-[-0.9px]" style={{ color: EM.muted }}>
            {tx(lang, 'বলুন, শুনছি…', 'Go ahead, I’m listening…')}
          </p>
        )}
      </div>
    );
  } else if (thinking) {
    // 2.2 — what the guest said small above; Pixie thinking out loud below (its opening line, when it has one)
    middle = (
      <div className="em-fade flex flex-col gap-12 px-7 pt-3">
        <p className="em-tight min-h-[24px] text-[18px] leading-[1.35]" style={{ color: EM.muted }}>{lastGuest}</p>
        <p className="em-tight text-[34px] font-medium leading-[1.15] tracking-[-0.7px]" style={{ color: EM.text2 }}>
          {aiLive || tx(lang, 'ভাবছি…', 'Let me think…')}
        </p>
      </div>
    );
  } else {
    // 1.2 / 7.1 / 9.1 — the greeting; after ordering, "Welcome back." with the order's status below
    // coming back after a while: the original theme's lines (the unsent order first, then the last order's real
    // status); a first visit: the welcome
    const lastOrder = recent[0] ?? null;
    const returnLine = (() => {
      if (!(aiFinal || '').trim()) return '';
      if (count > 0) return tx(lang, 'আপনার অর্ডার প্রসেস হচ্ছে, আরও কিছু নিতে চান?', 'Your order is in progress — would you like anything else?');
      const idle = tx(lang, 'কী খেতে ইচ্ছে করছে? বলুন…', 'What are you in the mood for? Just tell me…');
      if (!lastOrder || lastOrder.status === 'cancelled') return idle;
      if (lastOrder.status === 'ready' || lastOrder.status === 'completed') return tx(lang, 'খাবার উপভোগ করুন! আর কিছু লাগবে?', 'Enjoy your meal! Need anything else?');
      if (lastOrder.status === 'placed')
        return tx(lang, 'আপনার অর্ডার পাঠানো হয়েছে — রেস্টুরেন্ট গ্রহণ করার অপেক্ষায়। আর কিছু লাগবে?', 'Your order has been sent — waiting for the restaurant to accept it. Need anything else?');
      return tx(lang, 'আপনার অর্ডার তৈরি হচ্ছে। আর কিছু লাগলে বলুন।', 'Your order is being prepared. Tell me if you need anything else.');
    })();
    // the welcome: in full from the start, under the greeting, its words lighting up as they're spoken — the same
    // caption before, while and after it's said (nothing jumps). "Being spoken" is the voice saying the welcome's own
    // text — not only the first seconds (the 8 s no-voice fallback once ended it mid-sentence: the greeting vanished
    // and the text restarted from the words said so far)
    const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
    const welcomeSpeaking = talking && !!w.sayingText && same(w.sayingText, welcome);
    const welcoming = welcomePending || welcomeSpeaking;
    const talkingReply = talking && !welcoming;
    const line = welcoming ? welcome : talking ? said : said || returnLine || welcome;
    const isWelcomeText = welcoming || same(line, welcome);
    // spoken words white, the ones still to come dim; waiting for the voice: all dim; said (or no voice): all white
    const welcomeSpans = captionSpans({
      text: welcome,
      spoken: welcomeSpeaking ? aiLive || '' : welcomePending ? '' : null,
      dishes: dishNames,
      dim: EM.faint,
      firstSentenceBright: false,
    });
    middle = (
      <div className="em-fade flex flex-col gap-[18px] px-7 pt-[clamp(24px,8dvh,96px)]">
        {!talkingReply && (
          <h1 className="em-tight text-[46px] font-medium leading-[1.04] tracking-[-1.1px]">
            {liveOrder ? tx(lang, 'আবার স্বাগতম।', 'Welcome back.') : greeting(lang)}
          </h1>
        )}
        {/* what the guest said, grey and quoted above the reply */}
        {talkingReply && lastGuest && (
          <p className="em-tight line-clamp-2 text-[17px] leading-[1.35]" style={{ color: EM.muted }}>“{lastGuest}”</p>
        )}
        {talkingReply ? (
          <Caption spans={captionOf(line)} className="em-tight text-[26px] font-medium leading-[1.2] tracking-[-0.4px]" />
        ) : isWelcomeText ? (
          <Caption spans={welcomeSpans} className="em-tight text-[24px] leading-[1.3] tracking-[-0.3px]" />
        ) : (
          <p className="em-tight text-[24px] leading-[1.3] tracking-[-0.3px]" style={{ color: EM.text2 }}>
            {line}
          </p>
        )}
        {moment && started && !welcoming && !talking && w.choices.length === 0 && (
          <MomentCard moment={moment} lang={lang} onDismiss={() => dismissMoment(moment.key)} onAdded={() => w.setManualOrder(true)} onChoose={setDish} />
        )}
        {/* which branch (two or more) — online guests can change it */}
        {w.choices.length === 0 && info?.branches?.length > 1 && branch && (
          <p className="text-[13px]" style={{ color: EM.text3 }}>
            {(info.branches as any[]).find((b) => b.slug === branch)?.name}
          </p>
        )}
      </div>
    );
  }

  return (
    <Shell
      glow={glow}
      header={
        <>
          <TopBar left={chrome.modeChip} right={chrome.right} />
          {chrome.statusCard}
        </>
      }
      footer={
        <div className="flex flex-col gap-2.5">
          {homeIdle && w.choices.length === 0 && (
            <SuggestedForYou lang={lang} onSeeAll={seeAllPicks} chips={starterChips} />
          )}
          {liveBar}
          {orderBar}
          <QuickReplies chips={chips} label={tx(lang, 'দ্রুত উত্তর', 'Quick replies')} />
          <BottomBar
            lang={lang}
            onMenu={() => navigate(route.menuHref())}
            onType={chrome.openChat}
            orb={<Orb mode={orbMode} label={orbLabel} pressProps={w.orbPressProps} ballRef={w.orbBallRef} />}
          />
        </div>
      }
      overlay={
        <>
          {chrome.overlays}
          <DishSheet item={dish} onClose={() => setDish(null)} lang={lang} onAdded={() => w.setManualOrder(true)} />
          <DishSheet item={editLine ? menuById.get(editLine.id) ?? null : null} line={editLine} onClose={() => setEditLine(null)} lang={lang} />
          {!started && (
            <Launch
              name={info?.name}
              logo={info?.logoUrl}
              table={online ? null : table}
              lang={lang}
              onLang={() => w.setSelectedLang(lang === 'en' ? 'bn' : 'en')}
              onStart={start}
            />
          )}
          <span className="sr-only" role="status" aria-live="polite">{orbLabel}</span>
        </>
      }
    >
      {middle}
    </Shell>
  );
}
