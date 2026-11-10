// apps/tastebud/src/themes/ember/EmberMenu.tsx
// Ember — the menu (4.1 – 4.6, 9.2). One long page: ✦ For you → Popular → the restaurant's sections; the tabs are
// anchors whose underline follows the scroll; search + tabs stick under the header. Rows: name, two lines of
// description, price and tags, the photo on the right with "+" → "− 1 +".
// What can be ordered NOW comes first: a section with nothing on right now (breakfast in the afternoon, dinner-only
// dishes) folds into one line at the very bottom — "Not available now · 14 dishes" — each with when it opens; inside
// an open section, a sold-out dish moves to its end, greyed. (The restaurant closed → nothing folds: the normal order
// with "Closed · opens …" on top.) Dishes this visit already ordered say so ("In your order · ×2").
// Talking on the menu: the menu stays the focus and voice is the remote — the screen's edge glows, Pixie's words
// show in the order bar's place (2-line rolling captions), the dish she means is outlined and scrolled to, and her
// suggestions filter the menu ("✦ Pixie's picks ×").
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Fuzzysort from 'fuzzysort';
import type { v1 } from '../../../../../packages/shared/src/types';
import { listCategories, listMenu, getHours } from '../../api/storefront';
import { useWaiterSession } from '../../waiter/useWaiterSession';
import { useCart } from '../../context/CartContext';
import { orderPath } from '../../utils/checkout-flow';
import { money } from '../../utils/ui-lang';
import { closedNote, isAvailableAt, nextOpening, nextStart } from '../../utils/availability';
import { useEmberChrome } from './Chrome';
import { useStoreRoute } from './store';
import { useVisit, useVisitSync } from './visit';
import { bnDigits, whenText } from './when';
import { filterLabels, useGuestFilter } from './guestFilter';
import {
  AddControl, BottomBar, DishSheet, EM, I, Orb, OrderBar, QuickReplies, Shell, StatusStrip, TopBar, imageOf, needsChoices,
  priceOf, tx, Caption, captionSpans, useLiveHeard, type Chip, type Lang,
} from './ui';

type Item = v1.MenuItemDTO & Record<string, any>;
type Section = { key: string; name: string; items: Item[]; reasons?: Record<string, string>; subtitle?: string; when?: string; opensKey?: string };

const TAG_STYLE = (tag: string) =>
  /veg|vegan|নিরামিষ/i.test(tag)
    ? { background: '#18241A', color: '#8FD19E' }
    : /spic|hot|ঝাল/i.test(tag)
    ? { background: '#2A1A12', color: '#FF9F7A' }
    : { background: '#232326', color: EM.text2 };

function DishRow({
  item,
  lang,
  reason,
  note,
  focus,
  onChoose,
  onAdded,
}: {
  item: Item;
  lang: Lang;
  reason?: string;
  note?: string;
  focus: boolean;
  onChoose: (i: Item) => void;
  onAdded: () => void;
}) {
  const soldOut = item.orderable === false || item.available === false || item.servedNow === false;
  const ordered = useVisit().ordered[String(item.id)] ?? 0;
  const img = imageOf(item);
  const price = priceOf(item);
  const tags = (Array.isArray(item.tags) ? item.tags : []).filter(Boolean).slice(0, 2) as string[];
  return (
    <div
      id={`dish-${item.id}`}
      className={`flex items-center gap-3.5 ${focus ? 'em-flash -mx-2.5 my-1 rounded-2xl p-2.5' : 'py-3'}`}
      style={focus ? { border: `1.5px solid ${EM.amber}`, background: 'rgba(245,165,36,0.07)' } : { borderBottom: `1px solid ${EM.borderSoft}` }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {reason && (
          <span className="flex items-center gap-[5px] text-[12px] font-semibold" style={{ color: EM.amber }}>
            {I.sparkle({ size: 12 })}
            {reason}
          </span>
        )}
        <span className="text-[16px] font-semibold" style={{ color: soldOut ? EM.text3 : EM.text }}>{item.name}</span>
        {item.description && (
          <span className="line-clamp-2 text-[13px] leading-[1.35]" style={{ color: soldOut ? EM.muted : EM.text3 }}>{item.description}</span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium" style={{ color: soldOut ? EM.text3 : EM.text }}>{money(price)}</span>
          {soldOut ? (
            <span className="text-[12px] font-semibold">{note || tx(lang, 'আজ শেষ', 'Sold out tonight')}</span>
          ) : (
            <>
              {ordered > 0 && (
                <span className="flex h-5 items-center rounded-full px-2 text-[11px] font-bold" style={{ background: EM.amberTint, color: EM.amber, border: `1px solid ${EM.amberLine}` }}>
                  {tx(lang, `অর্ডারে আছে · ×${bnDigits(ordered)}`, `In your order · ×${ordered}`)}
                </span>
              )}
              {item.signature && <span className="text-[11px] font-semibold tracking-[0.4px]" style={{ color: EM.amber }}>{tx(lang, 'শেফের পছন্দ', "CHEF'S PICK")}</span>}
              {tags.map((t) => (
                <span key={t} className="flex h-5 items-center rounded-full px-2 text-[11px] font-semibold" style={TAG_STYLE(t)}>
                  {t}
                </span>
              ))}
            </>
          )}
        </span>
      </div>
      <div
        className="relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-2xl"
        style={{ background: '#2A1F12', opacity: soldOut ? 0.5 : 1 }}
      >
        {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {!soldOut && (
          <AddControl
            wide
            item={{ id: String(item.id), name: item.name, price, imageUrl: img, choices: needsChoices(item) }}
            onChoose={() => onChoose(item)}
            onAdded={onAdded}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}

/** The caption card in the order bar's place while voice is in use (4.3 – 4.5). */
function CaptionCard({
  mode,
  said,
  spans,
  you,
  lang,
  collapsed,
  onOpen,
}: {
  mode: 'listening' | 'thinking' | 'talking' | 'done';
  said: string;
  /** coloured words: the guest's live words (listening) or Pixie's captions (talking / done) */
  spans?: ReturnType<typeof captionSpans>;
  you: string;
  lang: Lang;
  collapsed: boolean;
  onOpen: () => void;
}) {
  const orb = <span aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-full" style={{ background: 'radial-gradient(circle at 34% 28%, #FFF1D6 0%, #F5A524 48%, #8A3E08 100%)', boxShadow: mode === 'talking' ? '0 0 10px rgba(245,165,36,0.6)' : undefined }} />;
  const card = 'mx-4 rounded-[22px] shadow-[0_-8px_28px_rgba(0,0,0,0.5)]';
  const cardStyle = { background: '#17171A', border: `1px solid ${EM.chipLine}` };
  if (collapsed)
    return (
      <button type="button" onClick={onOpen} aria-label={`${said} — ${tx(lang, 'পুরো কথোপকথন', 'Open the full conversation')}`} className={`${card} em-rise flex h-12 items-center gap-2.5 px-3 text-left`} style={cardStyle}>
        {orb}
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{said}</span>
        <span style={{ color: EM.muted }} className="flex">{I.chevron()}</span>
      </button>
    );
  if (mode === 'listening' || mode === 'thinking')
    return (
      <div role="status" aria-live="polite" className={`${card} em-rise flex h-[108px] flex-col gap-1.5 px-4 py-3.5`} style={cardStyle}>
        <span className="flex items-center gap-2 text-[12px] font-semibold tracking-[1px]" style={{ color: EM.text3 }}>
          {orb}
          {mode === 'listening' ? tx(lang, 'শুনছি', 'LISTENING') : tx(lang, 'ভাবছি', 'THINKING')}
        </span>
        {mode === 'listening' && spans?.length ? (
          <Caption spans={spans} className="em-tight line-clamp-2 text-[20px] font-medium leading-[1.3] tracking-[-0.2px]" />
        ) : (
          <p className="em-tight text-[20px] font-medium leading-[1.3] tracking-[-0.2px]" style={{ color: mode === 'listening' ? EM.muted : EM.text2 }}>
            {mode === 'listening' ? tx(lang, 'বলুন, শুনছি…', 'Go ahead, I’m listening…') : said || '…'}
          </p>
        )}
      </div>
    );
  return (
    <div role="status" aria-live="polite" className={`${card} em-rise flex h-28 flex-col gap-2 px-4 pb-3.5 pt-3`} style={cardStyle}>
      <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]" style={{ color: EM.muted }}>
        {orb}
        <span className="min-w-0 truncate">{you ? `${tx(lang, 'আপনি', 'You')}: “${you}”` : tx(lang, 'পিক্সি বলছে', 'Pixie')}</span>
      </span>
      {/* a 2-line window: older lines scroll up and fade out, the card never grows */}
      <div className="relative h-14 overflow-hidden" style={{ WebkitMaskImage: 'linear-gradient(transparent, #000 16px)', maskImage: 'linear-gradient(transparent, #000 16px)' }}>
        {spans ? (
          <Caption spans={spans} className="em-tight absolute inset-x-0 bottom-0 text-[19px] font-medium leading-7 tracking-[-0.2px]" />
        ) : (
          <p className="em-tight absolute inset-x-0 bottom-0 text-[19px] font-medium leading-7 tracking-[-0.2px]">{said}</p>
        )}
      </div>
    </div>
  );
}

export default function EmberMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const route = useStoreRoute();
  const { sub, branch, channel, online } = route;
  const w = useWaiterSession({
    subdomain: sub,
    branch: branch ?? undefined,
    channel,
    onOpenMenu: () => {},
    onCheckoutStep: () => navigate(route.checkoutHref),
  });
  const lang: Lang = w.selectedLang === 'en' ? 'en' : 'bn';
  const chrome = useEmberChrome({ w, route, chatChips: [tx(lang, 'কোনটা ঝাল কম?', 'Which is mildest?'), tx(lang, 'নিরামিষ দেখান', 'Show me vegetarian')] });
  const { items: cartItems, count, subtotal } = useCart();
  const { active } = useVisitSync(sub);
  const liveOrder = active[0] ?? null;
  const visit = useVisit();

  /* ---------- the menu (the server decides what's served now — as the original menu page) */
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['publicMenu', { subdomain: sub, branchSlug: branch ?? undefined, channel }],
    queryFn: () => listMenu({ subdomain: sub, branch: branch ?? undefined, channel }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['publicCategories', { subdomain: sub, branchSlug: branch ?? undefined, channel }],
    queryFn: async () => {
      try {
        return await listCategories({ subdomain: sub, branch: branch ?? undefined, channel });
      } catch {
        return [] as v1.CategoryDTO[];
      }
    },
    staleTime: 60_000,
  });
  const { data: hours } = useQuery({
    queryKey: ['publicHours', { subdomain: sub, branchSlug: branch ?? undefined }],
    queryFn: () => getHours(sub, branch ?? undefined),
    staleTime: 300_000,
  });
  const now = new Date();
  const openNow = isAvailableAt(hours?.openingHours ?? [], now, hours?.timezone ?? null);
  const opensAt = openNow ? null : nextOpening(hours?.openingHours ?? [], now, hours?.timezone ?? null);
  const shown = useMemo(
    () => (items as Item[]).filter((it) => !it.hidden && it.status !== 'hidden' && (openNow || it.servedNow !== false)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, openNow],
  );
  // what the guest told Pixie they can't eat: those dishes hidden, the chips on top say why (one tap shows all)
  const gf = useGuestFilter(sub, w.lastMeta);
  const hideSig = gf.on && gf.filter ? gf.filter.hide.join(',') : '';
  const visible = useMemo(() => {
    if (!hideSig) return shown;
    const hide = new Set(hideSig.split(','));
    return shown.filter((it) => !hide.has(String(it.id)));
  }, [shown, hideSig]);
  const hiddenCount = shown.length - visible.length;
  /** can be ordered right now */
  const canOrder = (it: Item) => it.orderable !== false && it.available !== false && it.servedNow !== false;

  const [query, setQuery] = useState('');
  const searched = useMemo(() => {
    const q = query.trim();
    if (!q) return visible;
    return Fuzzysort.go(q, visible, { keys: ['name', 'description', 'categoryName'] }).map((r) => r.obj);
  }, [visible, query]);

  // Pixie's suggestions on the menu filter it (4.6)
  const pixieIds = w.showSuggestions ? w.suggestedItems.map((s: any) => String(s.id ?? '')).filter(Boolean) : [];
  const filtered = pixieIds.length ? searched.filter((it) => pixieIds.includes(String(it.id))) : searched;
  const clearFilter = () => {
    w.setShowSuggestions(false);
    w.setHighlightIds([]);
  };

  /* ---------- sections: ✦ For you, Popular, then the restaurant's own order */
  const { sections, folded } = useMemo(() => {
    const out: Section[] = [];
    const folded: Section[] = [];
    // in the order already — in the cart, or ordered earlier this visit — is never "for you"
    const inCart = new Set([...cartItems.map((c) => c.id), ...Object.keys(visit.ordered)]);
    const catName = new Map<string, string>();
    const catOrder = new Map<string, number>();
    (categories as any[]).forEach((c, i) => {
      const id = String(c.id ?? c._id ?? '');
      catName.set(id, String(c.name ?? ''));
      catOrder.set(id, i);
    });
    const catOf = (it: Item) => String(it.categoryId ?? (Array.isArray(it.categoryIds) ? it.categoryIds[0] : '') ?? '');
    if (!query && !pixieIds.length) {
      // For you: the chef's picks you haven't ordered, then something from a part of the menu not in your order yet
      const reasons: Record<string, string> = {};
      const picks: Item[] = [];
      for (const it of filtered) {
        if (picks.length >= 2) break;
        if (it.signature && !inCart.has(String(it.id)) && canOrder(it)) {
          picks.push(it);
          reasons[it.id] = tx(lang, 'আজকের শেফের পছন্দ', "Chef's pick tonight");
        }
      }
      if (cartItems.length) {
        const cartCats = new Set(cartItems.map((c) => catOf((items as Item[]).find((x) => String(x.id) === c.id) ?? ({} as Item))));
        const seenCats = new Set<string>();
        for (const it of filtered) {
          if (picks.length >= 4) break;
          const c = catOf(it);
          if (!c || cartCats.has(c) || seenCats.has(c) || inCart.has(String(it.id)) || picks.includes(it) || !canOrder(it)) continue;
          seenCats.add(c);
          picks.push(it);
          reasons[it.id] = tx(lang, 'আপনার অর্ডারের সাথে মানাবে', 'Goes with your order');
        }
      }
      if (picks.length)
        out.push({
          key: 'for-you',
          name: tx(lang, 'আপনার জন্য', 'For you'),
          items: picks,
          reasons,
          subtitle: tx(lang, 'আপনার অর্ডার আর আজকের ভালো খাবার দেখে', "Based on your order and what's good tonight"),
        });
      const popular = filtered.filter((it) => it.signature && canOrder(it)).slice(0, 6);
      if (popular.length) out.push({ key: 'popular', name: tx(lang, 'জনপ্রিয়', 'Popular'), items: popular });
    }
    const groups = new Map<string, Item[]>();
    for (const it of filtered) {
      const c = catOf(it) || '__other';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(it);
    }
    // browsing an open restaurant: a section with nothing on right now folds to the bottom (soonest to open first)
    const fold = openNow && !query && !pixieIds.length;
    const catById = new Map<string, any>((categories as any[]).map((c) => [String(c.id ?? c._id ?? ''), c]));
    const opens = (c: string, list: Item[]) => {
      const tz = hours?.timezone ?? null;
      const cat = catById.get(c);
      const starts = [nextStart(cat?.availability, now, tz), ...list.map((it) => nextStart(it.availability, now, tz))]
        .filter((n): n is NonNullable<typeof n> => !!n)
        .sort((a, b) => a.offset - b.offset || a.start.localeCompare(b.start));
      return starts[0] ?? null;
    };
    Array.from(groups.entries())
      .sort((a, b) => (catOrder.get(a[0]) ?? 1e9) - (catOrder.get(b[0]) ?? 1e9))
      .forEach(([c, list]) => {
        const name = catName.get(c) || String(list[0]?.categoryName || tx(lang, 'অন্যান্য', 'More'));
        // what can be ordered first; a sold-out dish moves to the end of its section
        const sorted = [...list.filter(canOrder), ...list.filter((it) => !canOrder(it))];
        if (fold && !list.some(canOrder)) {
          const n = opens(c, list);
          folded.push({ key: `cat-${c}`, name, items: sorted, when: n ? whenText(n, lang) : undefined, ...(n ? { opensKey: `${n.offset}|${n.start}` } : {}) });
        } else out.push({ key: `cat-${c}`, name, items: sorted });
      });
    folded.sort((a, b) => (a.opensKey ? 0 : 1) - (b.opensKey ? 0 : 1) || String(a.opensKey).localeCompare(String(b.opensKey)));
    return { sections: out, folded };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, categories, cartItems, query, pixieIds.join(','), lang, openNow, visit, hours]);
  const [foldOpen, setFoldOpen] = useState(false);
  const foldCount = folded.reduce((n, s) => n + s.items.length, 0);

  /* ---------- tabs follow the scroll; a tab scrolls to its section */
  const scroller = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string>('');
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop + 24; // (the search and tabs sit above the scrolling list)
      let cur = sections[0]?.key ?? '';
      for (const s of sections) {
        const node = document.getElementById(`sec-${s.key}`);
        if (node && node.offsetTop <= top) cur = s.key;
      }
      setActiveKey(cur);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [sections]);
  useEffect(() => {
    tabsRef.current?.querySelector(`[data-tab="${activeKey}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);
  const jump = (key: string) => {
    const go = () => {
      const node = document.getElementById(`sec-${key}`);
      if (node && scroller.current) scroller.current.scrollTo({ top: node.offsetTop - 4, behavior: 'smooth' });
    };
    if (folded.some((f) => f.key === key) && !foldOpen) {
      setFoldOpen(true);
      window.setTimeout(go, 60);
    } else go();
  };
  // "See all picks" on Home → open on ✦ For you
  useEffect(() => {
    if (location.hash === '#for-you' && sections.some((s) => s.key === 'for-you')) window.setTimeout(() => jump('for-you'), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, sections.length]);
  // the dish Pixie is talking about: scrolled to and outlined
  const focusId = w.highlightIds[0] ?? null;
  useEffect(() => {
    if (!focusId) return;
    const node = document.getElementById(`dish-${focusId}`);
    if (node && scroller.current) scroller.current.scrollTo({ top: Math.max(0, node.offsetTop - 80), behavior: 'smooth' });
  }, [focusId]);

  /* ---------- voice on the menu */
  const thinking = w.orbMode === 'thinking';
  const talking = w.orbMode === 'talking';
  const voiceOn = w.listening || thinking || talking;
  const said = (w.aiLive || w.aiFinal || '').trim();
  const typedLast = [...chrome.log].reverse().find((m) => m.who === 'guest' && Date.now() - m.at < 60_000)?.text ?? '';
  const lastGuest = (w.heard && Date.now() - w.heardAt < 60_000 ? w.heard : '') || typedLast;
  const liveSpans = useLiveHeard(w.listening ? w.heardLive : '');
  const dishNames = useMemo(() => (items as Item[]).map((x) => String(x.name || '')), [items]);
  const speakSpans = talking && w.sayingText
    ? captionSpans({ text: w.sayingText, spoken: w.aiLive || '', dishes: dishNames, dim: EM.faint })
    : undefined;
  // after Pixie finishes: one line + the quick replies; the line fades ~4 s later (chips stay until answered)
  const [doneAt, setDoneAt] = useState(0);
  const wasVoice = useRef(false);
  useEffect(() => {
    if (voiceOn) wasVoice.current = true;
    else if (wasVoice.current) {
      wasVoice.current = false;
      setDoneAt(Date.now());
    }
  }, [voiceOn]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!doneAt) return;
    const t = window.setTimeout(() => tick((n) => n + 1), 4100);
    return () => window.clearTimeout(t);
  }, [doneAt]);
  const chips: Chip[] = [];
  if (!voiceOn) {
    if (w.choices.length) w.choices.forEach((c) => chips.push({ label: c.label, onClick: () => chrome.say(c.say) }));
    else if (w.pickOptions.length) {
      const p = w.pickOptions[0];
      const opts = p.missing.includes('size') && p.sizes.length ? p.sizes.map((s) => s.name) : (p.groups.find((g) => p.missing.includes(g.name)) ?? p.groups[0])?.options.map((o) => o.name) ?? [];
      opts.slice(0, 4).forEach((o) => chips.push({ label: o, onClick: () => chrome.say(o) }));
    } else if (focusId && /[?？]\s*$/.test(said) && Date.now() - doneAt < 60_000) {
      // "Want one?" about the dish on screen → add it / something milder / done
      const dish = (items as Item[]).find((x) => String(x.id) === focusId);
      if (dish) {
        chips.push({ label: tx(lang, `${dish.name} যোগ করুন`, `Add ${dish.name.toLowerCase()}`), primary: true, onClick: () => chrome.say(tx(lang, `${dish.name} যোগ করুন`, `Add ${dish.name}`)) });
        chips.push({ label: tx(lang, 'আরেকটু কম ঝাল', 'Something milder'), onClick: () => chrome.say(tx(lang, 'আরেকটু কম ঝাল কিছু', 'Something milder')) });
        chips.push({ label: tx(lang, 'ঠিক আছে', 'Done'), onClick: () => w.setHighlightIds([]) });
      }
    }
  }
  const showDone = !voiceOn && !!doneAt && (Date.now() - doneAt < 4000 || chips.length > 0) && !!said;
  const caption = voiceOn ? (
    <CaptionCard mode={w.listening ? 'listening' : thinking ? 'thinking' : 'talking'} said={w.aiLive || ''} spans={w.listening ? liveSpans : speakSpans} you={lastGuest} lang={lang} collapsed={false} onOpen={chrome.openChat} />
  ) : showDone && !pixieIds.length ? (
    <CaptionCard mode="done" said={said} you="" lang={lang} collapsed onOpen={chrome.openChat} />
  ) : null;

  const orbLabel = w.listening
    ? tx(lang, 'শুনছি', 'Listening')
    : thinking
    ? tx(lang, 'ভাবছি', 'Thinking')
    : talking
    ? tx(lang, 'থামাতে ট্যাপ করুন', 'Tap to interrupt')
    : chips.length
    ? tx(lang, 'উত্তর দিতে ট্যাপ করুন', 'Tap to reply')
    : tx(lang, 'যেকোনো খাবার নিয়ে জিজ্ঞেস করুন', 'Ask about any dish');

  const [dish, setDish] = useState<Item | null>(null);
  const itemNote = (it: Item): string | undefined => {
    if (canOrder(it)) return undefined;
    if (!openNow) return closedNote({ at: now, tz: hours?.timezone ?? null, openingHours: hours?.openingHours ?? [] }) ?? undefined;
    const reason = (it as any).unavailable?.reason;
    if (reason === 'sold-out' || it.available === false) {
      // the owner set when it comes back → say it ("শেষ · সন্ধ্যা ৬টায় আবার")
      const back = (it as any).soldOutUntil ? new Date((it as any).soldOutUntil) : null;
      if (back && back.getTime() > Date.now()) {
        const days = Math.round((new Date(back).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
        const when = whenText({ offset: days, day: back.getDay(), start: `${back.getHours()}:${String(back.getMinutes()).padStart(2, '0')}` }, lang);
        const at = /টা$/.test(when) ? `${when}য়` : `${when}-এ`; // ("৬টায়", "৬:৩০-এ")
        return tx(lang, `শেষ · ${at} আবার`, `Sold out · back ${when}`);
      }
      return tx(lang, 'আজ শেষ', 'Sold out today');
    }
    const cat = (categories as any[]).find((c) => String(c.id ?? c._id) === String(it.categoryId ?? ''));
    const n = nextStart(it.availability, now, hours?.timezone ?? null) ?? nextStart(cat?.availability, now, hours?.timezone ?? null);
    if (n) return tx(lang, `${whenText(n, 'bn')} থেকে`, `From ${whenText(n, 'en')}`);
    return tx(lang, 'এখন পাওয়া যাচ্ছে না', 'Not available right now');
  };

  const bars = caption ? (
    caption
  ) : (
    <>
      {pixieIds.length > 0 && (
        <div role="status" className="em-rise mx-6 flex h-11 items-center gap-2.5 rounded-full pl-3.5 pr-1.5" style={{ border: `1px solid ${EM.chipLine}`, background: EM.amberTint }}>
          <span aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-full" style={{ background: 'radial-gradient(circle at 34% 28%, #FFF1D6 0%, #F5A524 48%, #8A3E08 100%)' }} />
          <span className="min-w-0 flex-1 truncate text-[14px]">{tx(lang, `এখানে ${filtered.length}টি খাবার।`, `Here are ${filtered.length} dishes.`)}</span>
          <button type="button" onClick={clearFilter} className="h-9 shrink-0 px-3 text-[14px] font-semibold" style={{ color: EM.amber }}>
            {tx(lang, 'সব দেখুন', 'Show all')}
          </button>
        </div>
      )}
      {liveOrder && <StatusStrip lang={lang} label={tx(lang, 'কিচেনে', 'in the kitchen')} onClick={() => navigate(orderPath(liveOrder.token, sub, branch))} />}
      {count > 0 && (
        <OrderBar
          label={`${liveOrder ? tx(lang, 'নতুন আইটেম', 'New items') : tx(lang, 'অর্ডার দেখুন', 'View order')} · ${money(subtotal)}`}
          count={count}
          onClick={() => navigate(route.checkoutHref)}
        />
      )}
    </>
  );

  return (
    <Shell
      glow="calm"
      edgeGlow={voiceOn}
      header={
        <>
          <TopBar
            onBack={() => navigate(route.homeHref)}
            title={tx(lang, 'মেনু', 'Menu')}
            right={
              <>
                {chrome.modeChip}
                {chrome.right}
              </>
            }
          />
          {chrome.statusCard}
          <div className="mt-3 flex h-11 items-center gap-2.5 rounded-full px-4" style={{ border: `1px solid ${EM.border}`, background: EM.surface }}>
            <span style={{ color: EM.text3 }} className="flex">{I.search()}</span>
            <input
              type="search"
              aria-label={tx(lang, 'খাবার খুঁজুন', 'Search dishes')}
              placeholder={tx(lang, 'খাবার খুঁজুন', 'Search dishes')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#A1A1A6]"
              style={{ color: EM.text }}
            />
          </div>
          {gf.filter && filterLabels(gf.filter, lang).length > 0 && (
            <div className="em-noscroll -mx-4 mt-2 flex items-center gap-2 overflow-x-auto px-4">
              {filterLabels(gf.filter, lang).map((l) => (
                <span
                  key={l}
                  className="flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold"
                  style={gf.on ? { background: EM.amberTint, color: EM.amber, border: `1px solid ${EM.amberLine}` } : { color: EM.text3, border: `1px dashed ${EM.border}` }}
                >
                  {l}
                </span>
              ))}
              <button
                type="button"
                onClick={() => gf.setOn(!gf.on)}
                className="h-8 shrink-0 whitespace-nowrap px-2 text-[13px] font-semibold"
                style={{ color: gf.on ? EM.text2 : EM.amber }}
              >
                {gf.on
                  ? hiddenCount > 0
                    ? tx(lang, `${bnDigits(hiddenCount)}টা লুকানো · সব দেখান`, `${hiddenCount} hidden · Show all`)
                    : tx(lang, 'সব দেখান', 'Show all')
                  : tx(lang, 'আবার চালু করুন', 'Turn back on')}
              </button>
            </div>
          )}
          {pixieIds.length ? (
            <div className="mt-2 flex h-11 items-center gap-2">
              <button
                type="button"
                aria-label={tx(lang, 'ফিল্টার সরান', "Remove filter: Pixie's picks")}
                onClick={clearFilter}
                className="flex h-9 items-center gap-1.5 rounded-full pl-3 pr-2.5 text-[14px] font-semibold"
                style={{ border: `1.5px solid ${EM.amber}`, background: EM.amberTint }}
              >
                <span style={{ color: EM.amber }} className="flex">{I.sparkle()}</span>
                {tx(lang, 'পিক্সির বাছাই', `${route.waiterName}'s picks`)}
                <span style={{ color: EM.text3 }} className="flex">{I.x()}</span>
              </button>
              <span className="text-[13px]" style={{ color: EM.text3 }}>{tx(lang, `${route.waiterName} ফিল্টার করেছে`, `Filtered by ${route.waiterName}`)}</span>
            </div>
          ) : (
            <div ref={tabsRef} role="tablist" className="em-noscroll -mx-4 mt-2 flex h-11 gap-[22px] overflow-x-auto px-6" style={{ borderBottom: `1px solid ${EM.borderSoft}` }}>
              {[...sections, ...folded].map((s) => {
                const on = s.key === activeKey;
                const off = folded.includes(s);
                return (
                  <button
                    key={s.key}
                    data-tab={s.key}
                    role="tab"
                    aria-selected={on}
                    type="button"
                    onClick={() => jump(s.key)}
                    className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap text-[15px]"
                    style={{
                      color: on ? EM.text : off ? EM.faint : EM.text3,
                      fontWeight: on ? 600 : 400,
                      borderBottom: on ? `2px solid ${EM.text}` : '2px solid transparent',
                    }}
                  >
                    {s.key === 'for-you' && <span style={{ color: EM.amber }} className="flex">{I.sparkle()}</span>}
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </>
      }
      footer={
        <div className="flex flex-col gap-2.5 pt-2">
          {bars}
          <QuickReplies chips={chips} label={tx(lang, 'দ্রুত উত্তর', 'Quick replies')} />
          <BottomBar
            lang={lang}
            menuActive
            onMenu={() => navigate(route.homeHref)}
            onType={chrome.openChat}
            orb={<Orb mode={w.orbMode} label={orbLabel} pressProps={w.orbPressProps} ballRef={w.orbBallRef} />}
          />
        </div>
      }
      overlay={
        <>
          {chrome.overlays}
          <DishSheet item={dish} onClose={() => setDish(null)} lang={lang} />
        </>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="em-noscroll h-full overflow-y-auto px-6 pb-6">
          {!openNow && (
            <div role="status" className="mt-3 rounded-2xl px-4 py-3 text-[14px]" style={{ background: EM.amberTint, border: `1px solid ${EM.amberLine}` }}>
              <span className="font-semibold">{tx(lang, 'এখন বন্ধ', 'Closed now')}</span>
              {opensAt ? <span style={{ color: EM.text3 }}> · {tx(lang, `খুলবে ${opensAt}`, `opens ${opensAt}`)}</span> : null}
            </div>
          )}
          {online && (
            <p className="mt-3 text-[13px]" style={{ color: EM.text3 }}>
              {chrome.fulfillment === 'delivery' ? tx(lang, 'ডেলিভারির দাম দেখানো হচ্ছে', 'Showing delivery prices') : tx(lang, 'পিকআপের দাম দেখানো হচ্ছে', 'Showing pickup prices')}
            </p>
          )}
          {isLoading ? (
            <div className="flex flex-col gap-4 pt-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex animate-pulse items-center gap-3.5">
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="h-4 w-2/3 rounded" style={{ background: EM.surface2 }} />
                    <div className="h-3 w-full rounded" style={{ background: EM.surface }} />
                  </div>
                  <div className="h-[100px] w-[100px] rounded-2xl" style={{ background: EM.surface }} />
                </div>
              ))}
            </div>
          ) : sections.length === 0 ? (
            <p className="pt-10 text-center text-[14px]" style={{ color: EM.muted }}>
              {query ? tx(lang, `“${query}” পাওয়া যায়নি।`, `Nothing found for “${query}”.`) : tx(lang, 'এখন কোনো খাবার নেই।', 'Nothing on the menu right now.')}
            </p>
          ) : (
            sections.map((s) => (
              <section key={s.key} id={`sec-${s.key}`}>
                {s.key === 'for-you' ? (
                  <div className="flex flex-col gap-0.5 pb-1 pt-4">
                    <span className="text-[17px] font-semibold">{tx(lang, 'আপনার জন্য বাছাই', 'Picked for you')}</span>
                    <span className="text-[13px]" style={{ color: EM.text3 }}>{s.subtitle}</span>
                  </div>
                ) : (
                  <span className="block pb-1 pt-4 text-[13px] font-semibold tracking-[0.4px]" style={{ color: EM.text3 }}>
                    {s.key === 'popular' ? tx(lang, 'আজকের জনপ্রিয়', 'Popular tonight') : s.name}
                  </span>
                )}
                {s.items.map((it) => (
                  <DishRow
                    key={`${s.key}-${it.id}`}
                    item={it}
                    lang={lang}
                    reason={s.reasons?.[it.id]}
                    note={itemNote(it)}
                    focus={String(it.id) === focusId && s.key !== 'for-you' && s.key !== 'popular'}
                    onChoose={setDish}
                    onAdded={() => w.setManualOrder(true)}
                  />
                ))}
              </section>
            ))
          )}
          {!isLoading && folded.length > 0 && (
            <div className="mt-7 overflow-hidden rounded-[18px]" style={{ background: EM.surface, border: `1px solid ${EM.border}` }}>
              <button
                type="button"
                aria-expanded={foldOpen}
                onClick={() => setFoldOpen((o) => !o)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px]" style={{ background: EM.surface2, color: EM.muted }}>◷</span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[15px] font-semibold">{tx(lang, 'এখন পাওয়া যায় না', 'Not available now')}</span>
                  <span className="truncate text-[12px]" style={{ color: EM.muted }}>
                    {tx(lang, `${bnDigits(foldCount)}টা ডিশ`, `${foldCount} dishes`)} · {folded.map((f) => f.name).join(', ')}
                  </span>
                </span>
                <span className="flex transition-transform duration-200" style={{ color: EM.muted, transform: foldOpen ? 'rotate(90deg)' : 'none' }}>{I.chevron()}</span>
              </button>
              {foldOpen && (
                <div className="em-fade px-4 pb-2" style={{ borderTop: `1px solid ${EM.borderSoft}` }}>
                  {folded.map((s) => (
                    <section key={s.key} id={`sec-${s.key}`}>
                      <span className="flex justify-between gap-2 pb-1 pt-4 text-[13px] font-semibold tracking-[0.4px]" style={{ color: EM.text3 }}>
                        <span>{s.name}</span>
                        {s.when && <span style={{ color: EM.amber, letterSpacing: 0 }}>{tx(lang, `${s.when} থেকে`, `from ${s.when}`)}</span>}
                      </span>
                      {s.items.map((it) => (
                        <DishRow key={`${s.key}-${it.id}`} item={it} lang={lang} note={s.when ? ' ' : itemNote(it)} focus={false} onChoose={setDish} onAdded={() => w.setManualOrder(true)} />
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10" style={{ background: `linear-gradient(rgba(11,11,12,0), ${EM.bg})` }} />
      </div>
    </Shell>
  );
}
