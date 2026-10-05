// apps/tastebud/src/pages/AIWaiterHome.tsx
// The waiter's home screen: the big orb, the subtitles, the "tap to start" welcome. The waiter itself — the voice
// session and how its replies are handled, its sheets and dock — is shared with the menu page: src/waiter/.
import React, { useRef, useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import CartFab from '../components/ai-waiter/CartFab';
import TenminOrb from '../components/ai-waiter/TenminOrb';
import { useCart } from '../context/CartContext';
import { useConversationStore } from '../state/conversation';
import { orderPath, storeBasePath } from '../utils/checkout-flow';
import { useOrderChannel } from '../utils/order-mode';
import { getOrder, recentOrders } from '../api/orders';
import { uiLang } from '../utils/ui-lang';
import { useTenantInfo } from '../utils/waiter-lang';
import LangSwitch from '../components/LangSwitch';
import ScrollText from '../components/ai-waiter/ScrollText';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTable, withTable } from '../utils/table';
import StartScreen from '../components/ai-waiter/StartScreen';
import { useWaiterSession, markWelcomeInteraction, WELCOME_INTERACT_KEY, WELCOME_INACTIVITY_MS } from '../waiter/useWaiterSession';
import WaiterSheets from '../waiter/WaiterSheets';

// ✅ Welcome text, in the waiter's language
const WELCOME_BN =
  'স্বাগতম! আমি পিক্সি - আপনার ভার্চুয়াল ওয়েটার। মেনু থেকে যেকোনো কিছু জানতে চাইলে কিংবা অর্ডার করতে আমাকে বলুন।';
// "{Restaurant}-এ স্বাগতম, আমি পিক্সি…" — plain "স্বাগতম!" until the restaurant's name has loaded
function welcomeText(lang: 'bn' | 'en', restaurant?: string | null): string {
  const name = (restaurant || '').trim();
  if (lang === 'en') {
    return `${name ? `Welcome to ${name}!` : 'Welcome!'} I'm Pixie, your virtual waiter. Ask me anything about the menu, or tell me what you'd like to order.`;
  }
  if (!name) return WELCOME_BN;

  const isBurgerHouse = /^burger[\s-]+house$/i.test(name);
  const banglaGreeting = isBurgerHouse
    ? 'বার্গার হাউসে স্বাগতম'
    : `${name}-এ স্বাগতম`;
  return WELCOME_BN.replace('স্বাগতম! আমি', `${banglaGreeting}, আমি`);
}

// A bottom-bar action beside the mic: brand-tinted icon chip over a short label. The label wraps (2 lines max)
// inside the tile's column rather than overflowing on narrow phones or in Bangla.
function BottomTile({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-[22px] bg-white/90 px-2 py-2.5 shadow-[0_8px_24px_rgba(250,40,81,0.10)] ring-1 ring-[#FA2851]/10 backdrop-blur-xl transition-all duration-200 hover:ring-[#FA2851]/25 active:scale-95"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FFD4DA] to-[#FFE9ED] text-[#FA2851] transition-transform duration-200 group-hover:scale-105">
        {icon}
      </span>
      <span className="line-clamp-2 w-full text-center text-[13px] font-semibold leading-tight text-[#1F1F1F] [overflow-wrap:anywhere]">
        {label}
      </span>
    </button>
  );
}

export default function AiWaiterHome() {
  const navigate = useNavigate();
  const { subdomain, branch, branchSlug } =
    useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();

  // ✅ Unlock overlay (first tap) state (with persistence)
  const [hasInteracted, setHasInteracted] = useState(false);

  // On mount, decide whether to show overlay based on last interaction timestamp
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(WELCOME_INTERACT_KEY);
      if (!raw) {
        // never interacted → show overlay
        setHasInteracted(false);
        return;
      }
      const last = parseInt(raw, 10);
      if (!Number.isFinite(last)) {
        setHasInteracted(false);
        return;
      }
      const now = Date.now();
      if (now - last > WELCOME_INACTIVITY_MS) {
        // too old → show overlay again
        setHasInteracted(false);
      } else {
        // within 10 minutes → skip overlay
        setHasInteracted(true);
      }
    } catch {
      setHasInteracted(false);
    }
  }, []);


  // fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.href =
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  // routing/state
  const resolvedSub =
    subdomain ??
    search.get('subdomain') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : null) ??
    'demo';

  const resolvedBranch =
    branch ??
    branchSlug ??
    search.get('branch') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.branch : null) ??
    undefined;

  // the link decides: "/dine-in?table=12" (the table's QR) → dine-in; "/t/<sub>" → the online shop (pickup / delivery)
  const resolvedChannel = useOrderChannel(resolvedSub);

  // the menu on the same side ("…/dine-in/menu?table=12" or "…/menu")
  const seeMenuHref = withTable(`${storeBasePath(resolvedSub, resolvedBranch ?? null)}/menu`, resolvedSub);

  // after 6 hours the order has long been served — no "Order #12 · track" pill or "your order is in" greeting
  const lastOrder = recentOrders(resolvedSub, 6 * 60 * 60 * 1000)[0];

  // THE WAITER (shared with the menu page — src/waiter): the voice session and how every reply is handled
  const w = useWaiterSession({
    subdomain: resolvedSub,
    branch: resolvedBranch ?? undefined,
    channel: resolvedChannel,
    onOpenMenu: () => navigate(seeMenuHref),
  });
  const {
    selectedLang, setSelectedLang, tts, setAi, setMeta, aiLive, aiFinal, uiMode, welcomePending, setWelcomePending,
    listening, micLevel, followListen, orbMode, startListening, sendTyped, orbPressProps, orbBallRef, holdHint,
    holdHintText, showHoldPill, choices, suggestedItems, showSuggestions, showTray, setShowTray, openSuggestions, goMenu,
  } = w;
  const tenantInfo = useTenantInfo(resolvedSub);
  const [tableNo] = useTable(resolvedSub);
  const WELCOME_TEXT = welcomeText(selectedLang === 'en' ? 'en' : 'bn', tenantInfo?.name);
  const { items: cartItems } = useCart();

  // ---- coming back to this page: never an old line or a leftover error — a short line for right now
  // (text only, never spoken). A real reply from the last minute stays.
  useEffect(() => {
    const store = useConversationStore as any;
    const st = store.getState?.() || {};
    if (!st.aiText) return; // first visit: nothing to replace
    const sorry = ['no-speech', 'unclear', 'no-audio', 'not_understood'].some((g) => (st.lastMeta?.guards || []).includes(g));
    const fresh = Date.now() - (st.aiAt || 0) < 60_000;
    // a checkout question ("দুইটা ট্রিপ্ল চিজ টাওআর… — অর্ডারটা দিয়ে দেব?", "which table?") belongs to the checkout the
    // guest just left — back here it's the tray line instead
    const d = st.lastMeta?.decision || {};
    const checkoutLine =
      !!(d.showCheckout || d.askTable || d.askDetails) || ['readback', 'table', 'details'].includes(d.checkoutStage);
    if (fresh && !st.aiNotice && !sorry && !checkoutLine) return;

    const en = uiLang() === 'en';
    const count = cartItems.reduce((n, it) => n + (it.qty || 0), 0);
    const trayLine = count
      ? en
        ? 'Your order is in progress — would you like anything else?'
        : 'আপনার অর্ডার প্রসেস হচ্ছে, আরও কিছু নিতে চান?'
      : '';
    const idleLine = en ? 'What are you in the mood for? Just tell me…' : 'কী খেতে ইচ্ছে করছে? বলুন…';
    const at = st.aiAt;
    const show = (line: string) => {
      // the guest may already be talking to the waiter again — don't overwrite that
      if ((store.getState?.().aiAt || 0) !== at) return;
      setAi(line);
      setMeta(null);
    };

    // unsent tray first — that's what needs doing
    if (trayLine || !lastOrder) {
      show(trayLine || idleLine);
      return;
    }
    // there's an order: say what's TRUE about it — its real status, checked first (never a guess like
    // "অর্ডার হয়ে গেছে" for an order that's already being cooked). Until the answer: a neutral line.
    show(en ? 'Tell me if you need anything else.' : 'আর কিছু লাগলে বলুন।');
    const shownAt = store.getState?.().aiAt || 0;
    let alive = true;
    getOrder(lastOrder.token)
      .then((o) => {
        // only refine our own return line — not something the waiter said since
        if (!alive || !o || (store.getState?.().aiAt || 0) !== shownAt) return;
        let line: string;
        if (o.status === 'cancelled') line = idleLine;
        else if (o.status === 'ready' || o.status === 'completed') line = en ? 'Enjoy your meal! Need anything else?' : 'খাবার উপভোগ করুন! আর কিছু লাগবে?';
        else if (o.status === 'placed')
          line = en
            ? 'Your order has been sent — waiting for the restaurant to accept it. Need anything else?'
            : 'আপনার অর্ডার পাঠানো হয়েছে — রেস্টুরেন্ট গ্রহণ করার অপেক্ষায়। আর কিছু লাগবে?';
        else line = en ? 'Your order is being prepared. Tell me if you need anything else.' : 'আপনার অর্ডার তৈরি হচ্ছে। আর কিছু লাগলে বলুন।';
        setAi(line);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UI mapping
  const bg = '#FFF8FA';

  // phones: a smaller ball (~132 px vs ~211 px) about a third of the way down; the box keeps the ball at 44%
  const isMobile = useIsMobile();
  const ORB_SIZE = isMobile ? 380 : 480;
  const ORB_TOP = isMobile ? `calc(36dvh - ${ORB_SIZE / 2}px)` : '0px';
  const ORB_BALL = ORB_SIZE * 0.44;
  const HOLD_PILL_SPACE = 56; // room under the ball for the "Hold to Talk" pill (the text sits below it)

  const orbRef = useRef<HTMLDivElement | null>(null);
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  // the tray button sits just above the bottom tiles (on a phone they span the width — it covered "AI suggestions")
  const [trayFabBottom, setTrayFabBottom] = useState<number | undefined>(undefined);
  useEffect(() => {
    const place = () => {
      const bar = bottomBarRef.current?.getBoundingClientRect();
      if (bar?.height) setTrayFabBottom(Math.round(window.innerHeight - bar.top + 16));
    };
    place();
    window.addEventListener('resize', place);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (bottomBarRef.current) ro?.observe(bottomBarRef.current);
    return () => {
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, []);
  const textWrapRef = useRef<HTMLDivElement | null>(null);
  const [textTop, setTextTop] = useState<number | null>(null);

  // ✅ Show welcome text until AI says something, but override with "Thinking..." while pending. While the welcome
  // is being spoken, only the words already said show (revealed with the voice).
  const visibleText =
    uiMode === 'thinking'
      ? 'Thinking...'
      : welcomePending
      ? aiLive || ''
      : (aiLive || aiFinal || WELCOME_TEXT) ?? '';

  useEffect(() => {
    let rafId = 0;
    const placeText = () => {
      if (!orbRef.current || !bottomBarRef.current || !textWrapRef.current) return;

      const orbRect = orbRef.current.getBoundingClientRect();
      const micRect = bottomBarRef.current.getBoundingClientRect();
      const scrollY =
        window.scrollY || document.documentElement.scrollTop || 0;

      const orbContainerSize = orbRect.height;
      const actualCircleSize = orbContainerSize * 0.44;
      const circlePadding = (orbContainerSize - actualCircleSize) / 2;

      const orbBottomY = orbRect.top + scrollY + circlePadding + actualCircleSize + HOLD_PILL_SPACE;
      const micTopY = micRect.top + scrollY;
      const midY = (orbBottomY + micTopY) / 2;

      const textH = textWrapRef.current.offsetHeight || 0;
      const top = midY - textH / 2;

      setTextTop(top);
    };
    rafId = requestAnimationFrame(placeText);
    window.addEventListener('resize', placeText);
    const ro = new ResizeObserver(placeText);
    if (textWrapRef.current) ro.observe(textWrapRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', placeText);
      ro.disconnect();
    };
  }, [visibleText, ORB_SIZE]);

  // ✅ First-tap handler: unlock audio + speak welcome, only when overlay shows
  const handleFirstTap = () => {
    if (hasInteracted) return;
    setHasInteracted(true);
    markWelcomeInteraction();
    // the welcome's words appear AS they're spoken (not all at once, then the voice a second later)
    setWelcomePending(true);
    try {
      tts.stop();
    } catch {}
    tts.speak(WELCOME_TEXT).catch(() => {
      setWelcomePending(false);
    });
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-between px-6"
      style={{
        fontFamily: `'Noto Sans Bengali', 'Inter', system-ui, sans-serif`,
        background: bg,
      }}
    >
      {/* Waiter language (default from the restaurant; the guest can switch) — above the tap-to-start overlay,
          so the guest can pick a language before the welcome is spoken */}
      <div
        className={`fixed right-4 z-[1600] ${showSuggestions || showTray ? 'hidden' /* the popup's close button lives there */ : ''}`}
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <LangSwitch value={selectedLang} onChange={setSelectedLang} />
      </div>

      {/* ORB — it is the mic: hold to talk, release to send (a tap only says "Hold to talk") */}
      <div
        ref={orbRef}
        className="absolute left-1/2 -translate-x-1/2 z-0 pointer-events-none"
        style={{ top: ORB_TOP }}
      >
        {/* box stays ORB_SIZE with the ball at 44% (the text placement below measures it that way) */}
        <div className="flex items-center justify-center" style={{ width: ORB_SIZE, height: ORB_SIZE }}>
          <button
            type="button"
            ref={orbBallRef}
            {...orbPressProps}
            className="pointer-events-auto relative rounded-full select-none touch-none focus:outline-none focus-visible:ring-4 focus-visible:ring-[#FA2851]/25"
            style={{ width: ORB_SIZE * 0.44, height: ORB_SIZE * 0.44, WebkitTapHighlightColor: 'transparent' }}
            aria-label={listening ? 'Listening — release to send' : 'Hold to talk'}
            title="Hold to talk"
          >
            <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <TenminOrb mode={orbMode} size={Math.round((ORB_SIZE * 0.44) / 0.76)} level={listening ? micLevel : 0} />
            </span>
          </button>

          {/* "Hold to Talk" — under the orb until the first hold; a tap brings it back with a wiggle */}
          {showHoldPill && (
            <span
              key={holdHint}
              className="qv-motion pointer-events-none absolute left-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#FA2851] shadow-[0_6px_20px_rgba(250,40,81,0.15)] ring-1 ring-[#FA2851]/10"
              style={{
                top: ORB_SIZE / 2 + ORB_BALL / 2 + 16,
                transform: 'translateX(-50%)',
                animation: holdHint ? 'qv-pill-nudge 500ms cubic-bezier(.3,.7,.3,1) both' : 'qv-pill-in 400ms ease-out both',
              }}
            >
              {holdHintText}
            </span>
          )}
        </div>
      </div>

      {/* Text */}
      <div
        ref={textWrapRef}
        className="absolute left-1/2 -translate-x-1/2 z-10 w-full max-w-[900px] px-6 text-center pointer-events-auto"
        style={{ top: textTop ?? '50vh' }}
      >
        {/* 4 lines tall; drag / scroll to read back — it follows the newest words unless the guest scrolled up */}
        <div className="mx-auto w-full max-w-[340px] md:max-w-[760px] lg:max-w-[900px]">
          <ScrollText
            text={visibleText}
            lines={4}
            lineHeight={1.5}
            className="whitespace-pre-wrap text-center text-[20px] font-semibold leading-[1.5] tracking-[-0.02em] text-[#1F1F1F] md:text-[34px]"
            tail={
              aiLive ? (
                <span aria-hidden="true" className="ml-1.5 inline-block h-[0.42em] w-[0.42em] animate-pulse rounded-full bg-[#FA2851] align-middle" />
              ) : null
            }
          />
        </div>

        {/* hands-free: the mic reopened by itself — the pill says so; this is the one tip that helps in a noisy room */}
        {listening && followListen && (
          <p className="mt-3 text-xs text-gray-500">
            {selectedLang === 'en' ? 'Hold the phone near your mouth' : 'ফোনটা মুখের কাছে ধরে বলুন'}
          </p>
        )}

        {/* "which one?" — the answers as buttons; one tap sends it (never misheard) */}
        {choices.length > 0 && !listening && uiMode !== 'thinking' && (
          <div className="mt-5 flex flex-wrap justify-center gap-2" role="group" aria-label="Choose one">
            {choices.map((c) => (
              <button
                key={c.say}
                type="button"
                onClick={() => void sendTyped(c.say)}
                className="max-w-full truncate rounded-full border border-rose-200 bg-white px-4 py-2.5 text-[15px] font-semibold text-gray-800 shadow-sm transition active:scale-95 hover:border-rose-300"
              >
                {c.label}
                {typeof c.price === 'number' && <span className="ml-1.5 font-normal text-gray-500">৳{c.price}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="fixed bottom-0 left-0 right-0 flex items-end justify-center pb-10 md:pb-12">
        {/* two equal columns, so a long label wraps inside its tile instead of overflowing (the orb is the mic) */}
        <div ref={bottomBarRef} className="relative grid w-full max-w-[400px] grid-cols-2 items-stretch gap-3 px-4">
          {/* Left: See menu */}
          <BottomTile
            label={selectedLang === 'en' ? 'See menu' : 'মেনু দেখুন'}
            onClick={goMenu}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
                <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
                <path d="M7 8h1.5M7 11h1.5M15.5 8H17M15.5 11H17" />
              </svg>
            }
          />

          {/* Right: AI suggestions — the cards we already have, or ask the waiter for some */}
          <BottomTile
            label={selectedLang === 'en' ? 'AI suggestions' : 'AI সাজেশন'}
            onClick={() => {
              if (suggestedItems.length) openSuggestions();
              // asked by the button: the cards (and the reply as text) — no voice, no mic
              else void sendTyped(selectedLang === 'en' ? 'What do you recommend?' : 'আপনি কী সাজেস্ট করবেন?', { silent: true });
            }}
            icon={
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
                <path d="M10 3.5c.3 0 .55.2.62.49l.86 3.38a3 3 0 0 0 2.15 2.15l3.38.86a.64.64 0 0 1 0 1.24l-3.38.86a3 3 0 0 0-2.15 2.15l-.86 3.38a.64.64 0 0 1-1.24 0l-.86-3.38a3 3 0 0 0-2.15-2.15l-3.38-.86a.64.64 0 0 1 0-1.24l3.38-.86a3 3 0 0 0 2.15-2.15l.86-3.38A.64.64 0 0 1 10 3.5z" />
                <path d="M18 2.5c.17 0 .32.11.36.28l.3 1.08c.1.36.38.64.74.74l1.08.3a.37.37 0 0 1 0 .72l-1.08.3a1.07 1.07 0 0 0-.74.74l-.3 1.08a.37.37 0 0 1-.72 0l-.3-1.08a1.07 1.07 0 0 0-.74-.74l-1.08-.3a.37.37 0 0 1 0-.72l1.08-.3c.36-.1.64-.38.74-.74l.3-1.08A.37.37 0 0 1 18 2.5z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* the waiter's sheets (suggestions, the tray with its picker) + its dock — shared with the menu page */}
      <WaiterSheets w={w} dockEnabled={hasInteracted} />

      {/* The guest's latest order — one tap to its live status */}
      {lastOrder && (
        <button
          type="button"
          onClick={() => navigate(orderPath(lastOrder.token, resolvedSub, resolvedBranch ?? null))}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-gray-900 shadow-md backdrop-blur"
        >
          {selectedLang === 'en' ? `Order #${lastOrder.orderNumber} · track` : `অর্ডার #${lastOrder.orderNumber} · দেখুন`}
        </button>
      )}

      {/* Floating minimized cart button (only when tray is closed & cart has items) */}
      <CartFab
        trayOpen={showTray}
        onOpenTray={() => setShowTray(true)}
        bottom={trayFabBottom}
      />

      {/* the start screen: logo + name, "Get started" (its tap unlocks the voice, then the welcome is spoken) */}
      {!hasInteracted && (
        <StartScreen
          name={tenantInfo?.name}
          logoUrl={tenantInfo?.logoUrl}
          table={resolvedChannel === 'dine-in' ? tableNo : null}
          lang={selectedLang === 'en' ? 'en' : 'bn'}
          onStart={handleFirstTap}
        />
      )}
    </div>
  );
}
