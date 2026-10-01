// apps/tastebud/src/pages/AIWaiterHome.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getWsURL, getStableSessionId } from '../utils/ws';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/CartModal';
import CartFab from '../components/ai-waiter/CartFab';
import type { WaiterIntent, AiReplyMeta } from '../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../utils/intent-routing';

import VoiceOrb from '../components/ai-waiter/VoiceOrb';

import { buildMenuIndex, resolveItemIdByName } from '../utils/item-resolver';
import { useCart } from '../context/CartContext';
import { usePublicMenu } from '../hooks/usePublicMenu';
import { useConversationStore } from '../state/conversation';
import { useTTS } from '../state/TTSProvider';
import { applyVoiceCartOps } from '../utils/voice-cart';
import { claimReveal, ownsReveal } from '../state/reveal-owner';
import { useCheckoutFlow, orderPath } from '../utils/checkout-flow';
import { useTable } from '../utils/table';
import { useOrderChannel } from '../utils/order-mode';
import { getOrder, recentOrders } from '../api/orders';
import { uiLang } from '../utils/ui-lang';
import { useTenantInfo, useWaiterLang } from '../utils/waiter-lang';
import LangSwitch from '../components/LangSwitch';
import {
  FOLLOW_UP_LISTEN_MS, PENDING_AUDIO_MAX, chooseOptionsOf, handsFreeOn, type ChooseOption,
} from '../utils/handsfree';
import AssistantHeader from '../components/ai-waiter/AssistantHeader';
import VoiceEdgeGlow from '../components/ai-waiter/VoiceEdgeGlow';

type VoiceState = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'waiting' | 'paused';
const VOICE_STATUS: Record<VoiceState, [string, string]> = {
  listening: ['শুনছি… বলুন', 'Listening… go ahead'],
  hearing: ['শুনছি…', 'Listening…'],
  thinking: ['ভাবছি…', 'Thinking…'],
  speaking: ['বলছি…', 'Speaking…'],
  waiting: ['এক মুহূর্ত…', 'One moment…'],
  paused: ['থামানো — ট্যাপ করে বলুন', 'Paused — tap to talk'],
};
import { earcon } from '../utils/earcon';

type UIMode = 'idle' | 'thinking' | 'talking';

// ✅ Welcome text, in the waiter's language
const WELCOME_BN =
  'স্বাগতম! আমি পিক্সি - আপনার ভার্চুয়াল ওয়েটার। মেনু থেকে যেকোনো কিছু জানতে চাইলে কিংবা অর্ডার করতে আমাকে বলুন।';
// "{Restaurant}-এ স্বাগতম, আমি পিক্সি…" — plain "স্বাগতম!" until the restaurant's name has loaded
function welcomeText(lang: 'bn' | 'en', restaurant?: string | null): string {
  const name = (restaurant || '').trim();
  if (lang === 'en') {
    return `${name ? `Welcome to ${name}!` : 'Welcome!'} I'm Pixie, your virtual waiter. Ask me anything about the menu, or tell me what you'd like to order.`;
  }
  return name ? WELCOME_BN.replace('স্বাগতম! আমি', `${name}-এ স্বাগতম, আমি`) : WELCOME_BN;
}

// 🔒 Welcome overlay persistence
const WELCOME_INTERACT_KEY = 'qravy:aiwaiter:lastInteractionAt';
const WELCOME_INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes

/* ------------ touch-swipe 4-line viewport ------------ */
function SwipeViewport({ text, showCursor }: { text: string; showCursor: boolean }) {
  const measureRef = React.useRef<HTMLParagraphElement | null>(null);
  const contentRef = React.useRef<HTMLParagraphElement | null>(null);
  const [boxH, setBoxH] = React.useState<number>(0);
  const [offset, setOffset] = React.useState(0);
  const maxOverflowRef = React.useRef(0);
  const draggingRef = React.useRef(false);
  const startYRef = React.useRef(0);
  const startOffsetRef = React.useRef(0);

  React.useEffect(() => {
    const measure = () => {
      if (!measureRef.current) return;
      const cs = window.getComputedStyle(measureRef.current);
      const fontSize = parseFloat(cs.fontSize || '24');
      const lh = cs.lineHeight === 'normal' ? fontSize * 1.4 : parseFloat(cs.lineHeight);
      const h = Math.round(lh * 4);
      setBoxH(h);
      if (contentRef.current) {
        const overflow = Math.max(0, contentRef.current.scrollHeight - h);
        maxOverflowRef.current = overflow;
        if (!draggingRef.current) setOffset(overflow);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (measureRef.current) ro.observe(measureRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  React.useEffect(() => {
    if (!contentRef.current || boxH <= 0) return;
    requestAnimationFrame(() => {
      const overflow = Math.max(0, contentRef.current!.scrollHeight - boxH);
      const wasAtBottom = Math.abs(maxOverflowRef.current - offset) < 2;
      maxOverflowRef.current = overflow;
      if (!draggingRef.current && wasAtBottom) setOffset(overflow);
    });
  }, [text, boxH, offset]);

  const onTouchStart = (e: React.TouchEvent) => {
    draggingRef.current = true;
    startYRef.current = e.touches[0].clientY;
    startOffsetRef.current = offset;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - startYRef.current;
    const next = Math.max(0, Math.min(maxOverflowRef.current, startOffsetRef.current - dy));
    setOffset(next);
  };

  const onTouchEnd = () => {
    draggingRef.current = false;
    if (Math.abs(maxOverflowRef.current - offset) < 8) setOffset(maxOverflowRef.current);
  };

  return (
    <div className="w-full max-w-[420px] md:max-w-[760px] lg:max-w-[900px] mx-auto">
      <p
        ref={measureRef}
        className="text-[30px] md:text-[40px] leading-[1.6] font-medium opacity-0 absolute"
      >
        A
      </p>
      <div
        style={{
          height: boxH || undefined,
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
          position: 'relative',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <p
          ref={contentRef}
          className="text-[30px] md:text-[40px] leading-[1.6] font-medium text-[#2D2D2D] whitespace-pre-wrap text-center"
          style={{
            transform: `translateY(-${offset}px)`,
            willChange: 'transform',
            transition: draggingRef.current ? 'none' : 'transform 140ms ease-out',
          }}
        >
          {text}
          {showCursor && <span className="ml-1 animate-pulse">▌</span>}
        </p>
      </div>
    </div>
  );
}
/* ---------------------- end swipe viewport ---------------------- */

/** How long to keep an utterance's socket open for the reply before giving up (safety net only). */
const REPLY_TIMEOUT_MS = 30_000;

export default function AiWaiterHome() {
  const navigate = useNavigate();
  const { subdomain, branch, branchSlug } =
    useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();

  const setAi = useConversationStore((s: any) => s.setAi);
  const startTtsReveal = useConversationStore((s: any) => s.startTtsReveal) ?? (() => {});
  const appendTtsReveal = useConversationStore((s: any) => s.appendTtsReveal) ?? (() => {});
  const finishTtsReveal = useConversationStore((s: any) => s.finishTtsReveal) ?? (() => {});
  const aiLive = useConversationStore((s: any) => s.aiTextLive);
  const aiFinal = useConversationStore((s: any) => s.aiText ?? s.ai ?? '');
  const lastMeta = useConversationStore((s: any) => s.lastMeta);
  const setMeta = useConversationStore((s: any) => s.setMeta);

  const tts = useTTS();

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

  const markWelcomeInteraction = () => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(WELCOME_INTERACT_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  // ===== word-sync (gapless) =====
  const MIN_STEP_MS = 80;
  const FALLBACK_STEP_MS = 120;
  const lastDueRef = useRef(0);
  const startedTextRef = useRef<string>('');
  const speakGenRef = useRef(0);
  const activeGenRef = useRef(0);
  const inSpeechRef = useRef(false);

  const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
  function scheduleAt(due: number, token: string) {
    const w = norm(token);
    if (!w) return;
    const safeDue = Math.max(due, lastDueRef.current + MIN_STEP_MS, performance.now() + 1);
    lastDueRef.current = safeDue;
    const delay = Math.max(0, safeDue - performance.now());
    setTimeout(() => {
      if (activeGenRef.current !== speakGenRef.current) return;
      try {
        appendTtsReveal(w);
      } catch {}
    }, delay);
  }

  const [speaking, setSpeaking] = useState(false);
  // the reply is in but its voice hasn't started yet (token / synthesis, ~0.5–2 s) → still "Thinking…", never a
  // blank "One moment" between the answer and the sound
  const [voicePending, setVoicePending] = useState(false);
  const voicePendingTimerRef = useRef<number | null>(null);
  const markVoicePending = (on: boolean) => {
    if (voicePendingTimerRef.current) window.clearTimeout(voicePendingTimerRef.current);
    voicePendingTimerRef.current = on ? window.setTimeout(() => setVoicePending(false), 8000) : null;
    setVoicePending(on);
  };
  const ttsStartedAtRef = useRef(0); // when the waiter's voice last started (the voice session waits for it)
  // the welcome is being spoken → its text is revealed with the voice (see visibleText); never longer than 8 s
  const [welcomePending, setWelcomePending] = useState(false);
  useEffect(() => {
    if (!welcomePending) return;
    const t = window.setTimeout(() => setWelcomePending(false), 8000); // no voice → the text shows anyway
    return () => window.clearTimeout(t);
  }, [welcomePending]);
  // the speech token is fetched while the guest is still looking at "tap to start" — the welcome starts sooner
  useEffect(() => {
    try {
      tts.prefetch();
    } catch {}
  }, [tts]);

  // one writer for the live text at a time (a mic bar in a pop-up takes over while it is open)
  const revealIdRef = useRef(Symbol('waiter-home'));
  useEffect(() => claimReveal(revealIdRef.current), []);

  useEffect(() => {
    const owns = () => ownsReveal(revealIdRef.current);
    const un = tts.subscribe({
      onStart: (text) => {
        setSpeaking(true);
        markVoicePending(false);
        ttsStartedAtRef.current = Date.now();
        if (!owns()) return;
        const liveNow = (useConversationStore as any).getState?.().aiTextLive || '';
        const cont = inSpeechRef.current || !!liveNow;
        if (!cont) {
          speakGenRef.current += 1;
          activeGenRef.current = speakGenRef.current;
          inSpeechRef.current = true;
          lastDueRef.current = 0;
          startedTextRef.current = text || '';
          // a new utterance: its words wait for the sound to start (see onPlaybackStart)
          playAnchorRef.current = null;
          queuedWordsRef.current = [];
          finishPendingRef.current = false;
          if (anchorFallbackRef.current) window.clearTimeout(anchorFallbackRef.current);
          anchorFallbackRef.current = null;
          try {
            startTtsReveal('');
          } catch {}
        }
      },
      // REAL-TIME WORDS: Azure reports each word (with its time in the audio) while it is still GENERATING the
      // audio — ahead of what the guest hears. So words are held until the sound actually starts, then each one
      // appears at that moment + its own offset: the text follows the voice, word by word.
      onWord: (w, off) => {
        if (!owns()) return;
        if (activeGenRef.current !== speakGenRef.current) return;
        if (playAnchorRef.current === null) {
          queuedWordsRef.current.push({ w, off });
          // a phone/SDK that never reports "playback started" → fall back to the first word's arrival
          if (!anchorFallbackRef.current) {
            anchorFallbackRef.current = window.setTimeout(() => anchorRevealRef.current(), 1500);
          }
          return;
        }
        placeWordRef.current(w, off);
      },
      onPlaybackStart: () => {
        if (!owns()) return;
        anchorRevealRef.current();
      },
      // the guest has HEARD the whole reply → now the mic may reopen (the voice session). Not on onEnd: that is
      // "synthesis done", seconds before the speaker stops — opening the mic then cut the waiter off mid-sentence.
      onPlaybackEnd: () => {
        setSpeaking(false);
        markVoicePending(false);
        setWelcomePending(false); // (the whole welcome has been heard — its full text stays)
        followUpTriggerRef.current?.();
      },
      onEnd: () => {
        if (!inSpeechRef.current || !owns()) {
          return;
        }
        // synthesis is done — but if the sound hasn't started yet, finish only after its words have been placed
        if (playAnchorRef.current === null) {
          finishPendingRef.current = true;
          return;
        }
        finishRevealRef.current();
      },
    });
    return () => un();
  }, [tts, appendTtsReveal, finishTtsReveal, setAi, startTtsReveal]);

  // the reveal's clock: the moment the sound started (words already reported are placed on it)
  const playAnchorRef = useRef<number | null>(null);
  const queuedWordsRef = useRef<{ w: string; off?: number }[]>([]);
  const finishPendingRef = useRef(false);
  const anchorFallbackRef = useRef<number | null>(null);
  const placeWordRef = useRef<(w: string, off?: number) => void>(() => {});
  placeWordRef.current = (w, off) => {
    const base = playAnchorRef.current ?? performance.now();
    const hasOff = typeof off === 'number' && isFinite(off) && off >= 0;
    scheduleAt(hasOff ? base + (off as number) : Math.max(performance.now(), lastDueRef.current + FALLBACK_STEP_MS), w);
  };
  const finishRevealRef = useRef<() => void>(() => {});
  finishRevealRef.current = () => {
    const myGen = speakGenRef.current;
    const wait = Math.max(0, lastDueRef.current - performance.now() + 80);
    setTimeout(() => {
      if (activeGenRef.current !== myGen) return;
      try {
        finishTtsReveal();
      } catch {}
      try {
        const st = (useConversationStore as any).getState?.() || {};
        const finalText =
          st.aiTextLive && String(st.aiTextLive).trim() ? String(st.aiTextLive) : String(startedTextRef.current || '');
        setAi(finalText);
      } catch {}
      inSpeechRef.current = false;
      speakGenRef.current += 1;
      // (still "speaking" until the audio has really finished — see onPlaybackEnd)
    }, wait);
  };
  const anchorRevealRef = useRef<() => void>(() => {});
  anchorRevealRef.current = () => {
    if (playAnchorRef.current !== null || !inSpeechRef.current) return;
    if (anchorFallbackRef.current) window.clearTimeout(anchorFallbackRef.current);
    anchorFallbackRef.current = null;
    playAnchorRef.current = performance.now();
    lastDueRef.current = 0;
    try {
      setAi(''); // the previous reply's text goes as this one starts being heard
    } catch {}
    for (const { w, off } of queuedWordsRef.current.splice(0)) placeWordRef.current(w, off);
    if (finishPendingRef.current) {
      finishPendingRef.current = false;
      finishRevealRef.current();
    }
  };

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

  // table from the QR → dine-in; otherwise the online shop (pickup / delivery) when the restaurant sells online
  const resolvedChannel = useOrderChannel(resolvedSub);
  const channelRef = useRef(resolvedChannel);
  channelRef.current = resolvedChannel;

  const seeMenuHref =
    (resolvedBranch ? `/t/${resolvedSub}/${resolvedBranch}/menu` : `/t/${resolvedSub}/menu`) +
    (resolvedChannel === 'dine-in' ? '/dine-in' : '');

  // checkout steps from the waiter (read-back → checkout page, placed → live order page)
  const [trayAskTable, setTrayAskTable] = useState(false);
  const openTrayForCheckout = React.useMemo(
    () => ({
      openTray: (ask: boolean) => {
        setShowSuggestions(false);
        setShowTray(true);
        setTrayAskTable(ask);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const handleCheckout = useCheckoutFlow(resolvedSub, resolvedBranch ?? null, openTrayForCheckout);
  // remember ?table=12 from the table QR for this restaurant
  const [tableNo] = useTable(resolvedSub);
  // after 6 hours the order has long been served — no "Order #12 · track" pill or "your order is in" greeting
  const lastOrder = recentOrders(resolvedSub, 6 * 60 * 60 * 1000)[0];

  // ws/audio
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // analyser + mic level
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const [listening, setListening] = useState(false);
  const [uiMode, setUiMode] = useState<UIMode>('idle');

  // hands-free (utils/handsfree): the server ends the turn when the guest stops talking; after the waiter's
  // question the mic reopens for a short listen window; "which one?" answers are buttons
  // THE VOICE SESSION (hands-free, like Gemini Live): one tap starts a conversation that keeps going on every
  // screen — after each reply the mic reopens by itself; nobody speaks for two listen windows (~16 s) → it pauses
  // (an open mic can't sit on a restaurant table forever). The pill at the top shows it and has mute / end.
  const [session, setSession] = useState<'off' | 'on' | 'paused'>('off');
  const sessionRef = useRef<'off' | 'on' | 'paused'>('off');
  sessionRef.current = session;
  const emptyWindowsRef = useRef(0); // listen windows in a row with no answer from the guest
  const pressSessionRef = useRef<'off' | 'on' | 'paused'>('off'); // the session when the mic button went down
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  const followUpRef = useRef(false); // a reply came in → listen when the waiter finishes speaking
  const followUpAtRef = useRef(0);
  const followUpsRef = useRef(0); // listen windows in a row without a tap
  const [followListen, setFollowListen] = useState(false); // a listen window is open ("Listening… just answer")
  const [choices, setChoices] = useState<ChooseOption[]>([]);
  const pendingAudioRef = useRef<ArrayBuffer[]>([]); // audio recorded before the hello went out (first syllable)
  const helloSentRef = useRef(false);
  const geoRef = useRef<{ lat: number; lon: number } | null>(null); // looked up once in the background (weather hint)
  const persistCtxRef = useRef<AudioContext | null>(null); // kept (suspended) between turns — iOS needs a tap-started one
  const workletCtxRef = useRef<AudioContext | null>(null);

  // the guest's choice (top-right switch) → else the restaurant's default (admin) → else Bangla
  const [selectedLang, setSelectedLang] = useWaiterLang(resolvedSub);
  const tenantInfo = useTenantInfo(resolvedSub);
  const WELCOME_TEXT = welcomeText(selectedLang === 'en' ? 'en' : 'bn', tenantInfo?.name);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ t: 'set_lang', lang: selectedLang }));
    }
  }, [selectedLang]);

  // gates
  const stoppingRef = useRef<boolean>(false);
  const finalSeenRef = useRef<boolean>(false);
  const pendingFinalResolverRef = useRef<null | ((ok: boolean) => void)>(null);
  const aiSeenRef = useRef<boolean>(false);
  const pendingAiResolverRef = useRef<null | ((ok: boolean) => void)>(null);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTray, setShowTray] = useState(false);

  const openSuggestions = () => {
    setShowTray(false);
    setShowSuggestions(true);
  };
  const openTray = () => {
    setShowSuggestions(false);
    setShowTray(true);
  };
  const goMenu = () => {
    setShowSuggestions(false);
    setShowTray(false);
    navigate(seeMenuHref);
  };

  // catalog + cart
  const {
    addItem, setQty, updateQty, removeItem, setNotes, clear, items: cartItems,
    setLineQty, removeLine, setLineNotes, replaceLine, setWarnings,
  } = useCart();
  // ---- coming back to this page: never an old line or a leftover error — a short line for right now
  // (text only, never spoken). A real reply from the last minute stays.
  useEffect(() => {
    const store = useConversationStore as any;
    const st = store.getState?.() || {};
    if (!st.aiText) return; // first visit: nothing to replace
    const sorry = ['no-speech', 'unclear', 'no-audio', 'not_understood'].some((g) => (st.lastMeta?.guards || []).includes(g));
    const fresh = Date.now() - (st.aiAt || 0) < 60_000;
    if (fresh && !st.aiNotice && !sorry) return;

    const en = uiLang() === 'en';
    const bnNum = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
    const count = cartItems.reduce((n, it) => n + (it.qty || 0), 0);
    const trayLine = count
      ? en
        ? `You have ${count} item${count > 1 ? 's' : ''} in your tray — place the order, or look for something more?`
        : `আপনার ট্রেতে ${bnNum(count)}টা আইটেম আছে — অর্ডার দেবেন, নাকি আরও কিছু দেখবেন?`
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

  // everything the waiter's tray changes need — exact lines, edits, undo restores, warnings
  const cartFns = {
    addItem, setQty, updateQty, removeItem, setNotes, clear,
    items: cartItems, setLineQty, removeLine, setLineNotes, replaceLine, setWarnings,
  };
  // the live cart goes with every utterance (the socket opens per utterance)
  const cartItemsRef = useRef(cartItems);
  cartItemsRef.current = cartItems;
  const tableRef = useRef(tableNo);
  tableRef.current = tableNo;
  const { items: storeItems } = usePublicMenu(resolvedSub, resolvedBranch, resolvedChannel);
  const [menuIndex, setMenuIndex] = useState<ReturnType<typeof buildMenuIndex> | null>(null);

  useEffect(() => {
    if (storeItems?.length) setMenuIndex(buildMenuIndex(storeItems));
  }, [storeItems]);

  type SuggestedItem = {
    id?: string;
    name?: string;
    price?: number;
    imageUrl?: string;
  };

  const [suggestedItems, setSuggestedItems] = useState<SuggestedItem[]>([]);
  // dishes the waiter pointed at when the guest asked about the list on screen ("which of these…")
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  // suggestions asked for while the tray is open — shown inside the tray
  const [trayPicks, setTrayPicks] = useState<{ id: string; name: string; price?: number; imageUrl?: string }[]>([]);

  // the voice session runs across the sheets, so a reply must see what's open NOW (not when its socket opened)
  const showSuggestionsRef = useRef(false);
  const showTrayRef = useRef(false);
  const shownIdsRef = useRef<string[]>([]); // the dishes on screen — "which of these…" is about them
  showSuggestionsRef.current = showSuggestions;
  showTrayRef.current = showTray;
  shownIdsRef.current = showSuggestions
    ? suggestedItems.map((s) => String(s.id ?? '')).filter(Boolean)
    : showTray
    ? trayPicks.map((p) => p.id)
    : [];

  const [upsellItems, setUpsellItems] = useState<
    { itemId?: string; id?: string; title: string; price?: number }[]
  >([]);

  function resolveStoreItemById(id?: string) {
    if (!id) return undefined as any;
    return storeItems?.find((s: any) => String(s?.id) === String(id));
  }

  function mergeFromStore(it: any, itemId?: string): SuggestedItem {
    const storeItem = itemId ? resolveStoreItemById(itemId) : undefined;
    const priceFromStore =
      typeof (storeItem as any)?.price === 'number' ? (storeItem as any).price : undefined;
    const priceFromMeta = typeof it?.price === 'number' ? it.price : undefined;
    return {
      id: itemId ?? undefined,
      name: (storeItem as any)?.name ?? it?.name ?? undefined,
      price: priceFromStore ?? priceFromMeta,
      imageUrl:
        (storeItem as any)?.imageUrl ??
        (storeItem as any)?.image ??
        undefined,
    };
  }

  function buildSuggestionsFromMeta(meta: AiReplyMeta | undefined): SuggestedItem[] {
    if (!menuIndex) return [];
    const out: SuggestedItem[] = [];

    // Items (order-style)
    const metaItems = Array.isArray(meta?.items) ? (meta!.items as any[]) : [];
    for (const it of metaItems) {
      const name = it?.name as string | undefined;
      let itemId = it?.itemId as string | undefined;
      if (!itemId && name) {
        const found = resolveItemIdByName(menuIndex, name);
        if (found) itemId = String(found);
      }
      out.push(mergeFromStore(it, itemId));
    }

    // Suggestions: flat + legacy grouped
    const suggestions: any[] = Array.isArray((meta as any)?.suggestions)
      ? (meta as any).suggestions
      : [];

    for (const s of suggestions) {
      if (Array.isArray(s?.items)) {
        // legacy grouped form
        for (const it of s.items) {
          const name = it?.name as string | undefined;
          let itemId = it?.itemId as string | undefined;
          if (!itemId && name) {
            const found = resolveItemIdByName(menuIndex, name);
            if (found) itemId = String(found);
          }
          out.push(mergeFromStore(it, itemId));
        }
      } else {
        // flat form
        const name = (s?.name as string | undefined) ?? (s?.title as string | undefined);
        let itemId =
          (s?.itemId as string | undefined) ??
          (s?.id as string | undefined);

        if (!itemId && name) {
          const found = resolveItemIdByName(menuIndex, name);
          if (found) itemId = String(found);
        }

        out.push(mergeFromStore(s, itemId));
      }
    }

    const seen = new Set<string>();
    return out.filter((x) => {
      const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildSuggestionsFromReplyText(replyText: string): SuggestedItem[] {
    if (!replyText || !storeItems?.length) return [];
    const lc = replyText.toLowerCase();
    const hits: SuggestedItem[] = [];

    for (const s of storeItems as any[]) {
      const name = (s?.name ?? '').toString();
      if (!name) continue;

      const nameHit = lc.includes(name.toLowerCase());
      const aliases: string[] = Array.isArray(s?.aliases) ? s.aliases : [];
      const aliasHit = aliases.some((a) => lc.includes(a.toLowerCase()));

      if (nameHit || aliasHit) {
        hits.push({
          id: String(s.id),
          name: s.name,
          price: typeof s.price === 'number' ? s.price : undefined,
          imageUrl: s.imageUrl ?? s.image ?? undefined,
        });
      }
    }

    const seen = new Set<string>();
    return hits.filter((x) => {
      const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function resolveIntent(meta?: AiReplyMeta, replyText?: string): WaiterIntent {
    if (meta?.intent) return normalizeIntent(meta.intent);
    if (Array.isArray(meta?.items) && meta.items.length) return 'order';
    return localHeuristicIntent(replyText || '');
  }

  /**
   * The waiter's "menu" intent means "a question about dishes" (price, spice, what drinks…), not
   * "open the menu page" — only an explicit request ("মেনু দেখান", "show me the menu") navigates.
   */
  function pageIntent(intent: WaiterIntent | undefined, meta?: AiReplyMeta | null): WaiterIntent | undefined {
    if (intent === 'menu' && !(meta as any)?.decision?.openMenu) return 'chitchat';
    return intent;
  }

  function handleIntentRouting(intent: WaiterIntent | undefined) {
    if (!intent) return;

    // If Suggestions modal is open (refs: the voice session's reply may come from an older render)
    if (showSuggestionsRef.current) {
      if (intent === 'order') {
        openTray();
        return;
      }
      if (intent === 'menu') {
        goMenu();
        return;
      }
      // suggestions/chitchat → stay
      return;
    }

    // If Tray modal is open
    if (showTrayRef.current) {
      if (intent === 'suggestions') {
        openSuggestions();
        return;
      }
      if (intent === 'menu') {
        goMenu();
        return;
      }
      // order/chitchat → stay
      return;
    }

    // From home state
    if (intent === 'suggestions') {
      openSuggestions();
      return;
    }
    if (intent === 'order') {
      openTray();
      return;
    }
    if (intent === 'menu') {
      goMenu();
      return;
    }
    // chitchat → no modal change
  }

  // A reply while the cards are open (the voice session talks on every screen)
  function handleSuggestionsReply(intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) {
    const m = meta as AiReplyMeta | undefined;
    if (m && storeItems && storeItems.length) {
      try {
        applyVoiceCartOps(m, storeItems as any[], cartFns);
      } catch {
        // ignore
      }
    }
    if (handleCheckout(m)) return; // read-back / placed → checkout or order page
    // "which of these is less spicy?" → the answer is highlighted in the list on screen (the list stays)
    setHighlightIds(Array.isArray((m as any)?.highlight) ? (m as any).highlight.map(String) : []);
    if ((m as any)?.onScreen) return;
    // new cards from this reply ("what drinks do you have?") → show them, not the previous ones
    if (m?.decision?.showSuggestionsModal) {
      const fresh = buildSuggestionsFromMeta(m);
      if (fresh?.length) setSuggestedItems(fresh);
    }
    const finalIntent = intent ?? resolveIntent(m, replyText);
    handleIntentRouting(pageIntent(finalIntent, m));
  }

  // A reply while the tray is open
  function handleTrayReply(intent?: WaiterIntent, meta?: AiReplyMeta, replyText?: string) {
    const m = meta as AiReplyMeta | undefined;
    if (m && storeItems && storeItems.length) {
      try {
        applyVoiceCartOps(m, storeItems as any[], cartFns);
      } catch {
        // ignore
      }
    }
    if (handleCheckout(m)) return; // read-back / placed → checkout or order page
    // "which of these is less spicy?" → the answer is highlighted in the list on screen (the list stays)
    setHighlightIds(Array.isArray((m as any)?.highlight) ? (m as any).highlight.map(String) : []);
    if ((m as any)?.onScreen) return;
    // "সাথে কি A অথবা B নিতে চান?" — what the order is missing, as the waiter's picks in the tray (replacing older ones)
    const upsellNow = Array.isArray((m as any)?.upsell) ? ((m as any).upsell as any[]) : [];
    if (m?.decision?.showUpsellTray && upsellNow.length) {
      setTrayPicks(
        mapUpsell(upsellNow)
          .filter((u) => u.id)
          .map((u) => ({ id: String(u.id), name: u.title, price: u.price })),
      );
      return;
    }
    // asked for ideas while in the tray → they appear IN the tray as "waiter's picks" (not tray lines);
    // saying or tapping one flies it in. The guest stays in their tray.
    if (m?.decision?.showSuggestionsModal) {
      const fresh = buildSuggestionsFromMeta(m);
      if (fresh?.length) {
        setTrayPicks(
          fresh
            .filter((f) => f.id)
            .map((f) => ({ id: String(f.id), name: String(f.name ?? ''), price: f.price, imageUrl: f.imageUrl })),
        );
        return;
      }
    }
    const finalIntent = intent ?? resolveIntent(m, replyText);
    if (finalIntent === 'suggestions') return; // stay in the tray
    handleIntentRouting(pageIntent(finalIntent, m));
  }

  function mapUpsell(
    upsell: any[],
  ): { itemId?: string; id?: string; title: string; price?: number }[] {
    return upsell.map((u: any) => ({
      itemId: u.itemId || u.id,
      id: u.itemId || u.id,
      title: String(u.title ?? u.name ?? ''),
      price: typeof u.price === 'number' ? u.price : undefined,
    }));
  }

  // "Thinking…" is shown between ai_reply_pending and ai_reply; if the reply never comes, recover
  const awaitingReplyRef = useRef(false);
  function giveUpWaiting() {
    if (!awaitingReplyRef.current) return;
    awaitingReplyRef.current = false;
    setUiMode('idle');
    try {
      setAi(
        selectedLang === 'en'
          ? "Sorry, I didn't get that in time — please say it again."
          : 'দুঃখিত, উত্তর দিতে দেরি হয়ে গেল — আরেকবার বলবেন?',
      );
    } catch {}
  }

  // small gates
  function waitForFinal(timeoutMs = 8000) {
    if (pendingFinalResolverRef.current) {
      try {
        pendingFinalResolverRef.current(false);
      } catch {}
      pendingFinalResolverRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingFinalResolverRef.current) {
          pendingFinalResolverRef.current(false);
          pendingFinalResolverRef.current = null;
        }
        resolve(false);
      }, timeoutMs);
      pendingFinalResolverRef.current = (ok: boolean) => {
        try {
          clearTimeout(timer);
        } catch {}
        pendingFinalResolverRef.current = null;
        resolve(ok);
      };
    });
  }

  function waitForAiReply(timeoutMs = 8000) {
    if (pendingAiResolverRef.current) {
      try {
        pendingAiResolverRef.current(false);
      } catch {}
      pendingAiResolverRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingAiResolverRef.current) {
          pendingAiResolverRef.current(false);
          pendingAiResolverRef.current = null;
        }
        resolve(false);
      }, timeoutMs);
      pendingAiResolverRef.current = (ok: boolean) => {
        try {
          clearTimeout(timer);
        } catch {}
        pendingAiResolverRef.current = null;
        resolve(ok);
      };
    });
  }

  // `listenMs`: a hands-free listen window after the waiter's question (the mic reopened by itself — nobody answers
  // → the server closes it quietly). `typed`: a tapped "which one?" answer, sent as the guest's words (no mic).
  async function startListening(opts?: { listenMs?: number; typed?: string }) {
    const followUp = !!opts?.listenMs;
    const typed = opts?.typed?.trim() || '';
    try {
      // any voice interaction counts as activity for welcome timer
      markWelcomeInteraction();

      if (listening || wsRef.current || ctxRef.current) return;
      if (!followUp) {
        followUpRef.current = false; // the guest acted — no pending listen window, and the count starts over
        followUpsRef.current = 0;
        emptyWindowsRef.current = 0;
        // a tap starts (or resumes) the hands-free conversation
        if (handsFreeOn()) setSession('on');
      } else {
        followUpsRef.current += 1;
        earcon('listen'); // the mic reopened by itself — a soft chime says "your turn"
      }
      setChoices([]);
      setFollowListen(followUp);
      pendingAudioRef.current = [];
      helloSentRef.current = false;
      try {
        tts.stop();
      } catch {}

      let src: MediaStreamAudioSourceNode | null = null;
      let node: AudioWorkletNode | null = null;
      if (!typed) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // one audio context for the visit, suspended between turns: iOS lets a tap-started context be resumed
      // later without a tap — that's what lets the mic reopen by itself after the waiter's question
      const kept = persistCtxRef.current;
      const ctx =
        kept && kept.state !== 'closed' ? kept : new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      persistCtxRef.current = ctx;
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {}
      }
      if (workletCtxRef.current !== ctx) {
        await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');
        workletCtxRef.current = ctx;
      }

      src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;
      node = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      nodeRef.current = node;

      // analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.08;
      analyserRef.current = analyser;
      src.connect(analyser);

      const backing = new ArrayBuffer(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(backing) as Uint8Array<ArrayBuffer>;

      const levelLoop = () => {
        if (!analyserRef.current || !timeDataRef.current) return;
        analyserRef.current.getByteTimeDomainData(
          timeDataRef.current as Uint8Array<ArrayBuffer>,
        );
        const buf = new Uint8Array(
          (timeDataRef.current as any).buffer as ArrayBuffer,
        );
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const noiseFloor = 0.02;
        const normLvl = Math.max(0, (rms - noiseFloor) / (1 - noiseFloor));
        const clamped = Math.min(0.9, normLvl);
        setMicLevel(clamped);
        levelRafRef.current = requestAnimationFrame(levelLoop);
      };
      levelRafRef.current = requestAnimationFrame(levelLoop);
      } // (no mic for a tapped answer)

      const ws = new WebSocket(getWsURL('/ws/voice'));
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';
      stoppingRef.current = false; // a new utterance is live (also if the socket never manages to open)
      let opened = false;

      ws.onopen = () => {
        opened = true;
        const sid = getStableSessionId();
        stoppingRef.current = false;
        finalSeenRef.current = false;
        aiSeenRef.current = false;

        const tz =
          typeof Intl !== 'undefined' &&
          Intl.DateTimeFormat().resolvedOptions().timeZone
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined;

        const localHour =
          typeof window !== 'undefined' ? new Date().getHours() : undefined;

        let helloSent = false;
        const sendHello = (extra?: any) => {
          if (helloSent) return;
          helloSent = true;
          try {
            ws.send(
              JSON.stringify({
                t: 'hello',
                sid,
                sessionId: sid,
                userId: 'guest',
                rate: 16000,
                ch: 1,
                lang: selectedLang,
                tenant: resolvedSub ?? 'demo',
                branch: resolvedBranch ?? null,
                channel: channelRef.current,
                tz,
                localHour,
                table: tableRef.current ?? undefined,
                cart: cartItemsRef.current,
                shown: shownIdsRef.current, // the cards / picks on screen — "which of these…" is about them
                // hands-free: the server ends the turn when the guest stops talking / closes a quiet listen window
                autoEnd: !typed && handsFreeOn(),
                listenMs: opts?.listenMs,
                ...(extra || {}),
              }),
            );
          } catch {}
          helloSentRef.current = true;
          if (typed) {
            // a tapped answer: the guest's words, exactly — no speech recognition
            try {
              ws.send(JSON.stringify({ t: 'say', text: typed }));
            } catch {}
            stoppingRef.current = true; // nothing more to send; the socket closing after the reply is expected
            setUiMode('thinking');
            return;
          }
          // the audio recorded while connecting (the first syllable!) goes out right after the hello
          const held = pendingAudioRef.current;
          pendingAudioRef.current = [];
          for (const buf of held) {
            try {
              ws.send(buf);
            } catch {}
          }
        };

        // the hello goes out AT ONCE. It used to wait for the phone's location (up to 1.5 s) — the server gives up
        // on a silent connection after 1.2 s, and answered "please repeat" to nobody. The location (a weather hint
        // only) is looked up in the background and rides along with the NEXT turn.
        sendHello(geoRef.current ? { geo: geoRef.current } : undefined);
        if (navigator.geolocation && !geoRef.current) {
          try {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                geoRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
              },
              () => {},
              { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 5000 },
            );
          } catch {}
        }

        if (!typed) setListening(true);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data);

          // hands-free: the server heard the guest stop talking → it's answering now (no tap needed)
          if (msg.t === 'auto_end') {
            void stopListening({ serverEnded: true });
            return;
          }
          // hands-free: the listen window passed with nobody (or someone else) speaking → close quietly
          if (msg.t === 'no_speech') {
            void stopListening({ quiet: true });
            // the conversation stays open for one more window; two silent ones → it pauses (tap the pill to go on)
            emptyWindowsRef.current += 1;
            if (sessionRef.current === 'on') {
              if (emptyWindowsRef.current < 2) {
                window.setTimeout(() => {
                  if (sessionRef.current === 'on') void startRef.current?.({ listenMs: FOLLOW_UP_LISTEN_MS });
                }, 300);
              } else {
                setSession('paused');
                earcon('pause');
              }
            }
            return;
          }
          if (msg.t === 'speech_start') {
            setFollowListen(false); // they're talking — the orb shows their voice
            emptyWindowsRef.current = 0;
            return;
          }

          if (msg.t === 'stt_final') {
            finalSeenRef.current = true;
            pendingFinalResolverRef.current?.(true);
            return;
          }

          if (msg.t === 'ai_reply_pending') {
            awaitingReplyRef.current = true;
            setUiMode('thinking');
            // get the voice connected while the waiter thinks, so the reply starts speaking right away
            tts.warm();
            return;
          }

          if (msg.t === 'ai_reply') {
            awaitingReplyRef.current = false;
            // one socket per utterance: the reply is in, so close it now (not on a fixed timer)
            setTimeout(() => {
              try {
                if (ws.readyState === WebSocket.OPEN) ws.close();
              } catch {}
            }, 0);
            const meta: AiReplyMeta | undefined = msg.meta;
            const replyText = (msg.replyText || '').toString().trim();
            const voiceText = (meta?.voiceReplyText || '').toString().trim();
            const speakText = voiceText || replyText;

            if (speakText) {
              try {
                tts.stop();
              } catch {}
              markVoicePending(true);
              tts.speak(speakText).catch((err) => {
                console.warn('[AIWaiterHome] TTS speak failed, showing text directly:', err);
                markVoicePending(false);
                setAi(speakText);
              });
            } else if (replyText) {
              setAi(replyText);
            }

            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(true);
            setUiMode('talking');

            setMeta(meta ?? null);
            // the waiter's flags on the tray (sold out, allergy clash) — every reply, not only when it changes the tray
            if (Array.isArray((meta as any)?.cartWarnings)) setWarnings((meta as any).cartWarnings);
            // "which one?" → the answers as buttons under the question
            setChoices(chooseOptionsOf(meta));
            // the voice session: after EVERY reply (on any screen) the mic reopens when the waiter finishes speaking —
            // except when the order is placed or the menu page opens. "Didn't catch that" counts as an empty turn
            // (two in a row → the session pauses, so noise can't keep it open).
            const guards: string[] = Array.isArray((meta as any)?.guards) ? (meta as any).guards : [];
            if (guards.some((g) => ['unclear', 'no-speech', 'no-audio', 'not_understood'].includes(g))) {
              emptyWindowsRef.current += 1;
            } else {
              emptyWindowsRef.current = 0;
            }
            const ends = !!(meta as any)?.decision?.orderPlaced || !!(meta as any)?.decision?.openMenu;
            if (sessionRef.current === 'on' && emptyWindowsRef.current >= 2) {
              setSession('paused');
              earcon('pause');
            }
            followUpRef.current = sessionRef.current === 'on' && emptyWindowsRef.current < 2 && !ends;
            followUpAtRef.current = Date.now();
            // no voice at all for this reply (nothing to say, a speech error) → still hand the turn back. Only when
            // the voice never STARTED — never cutting the waiter off while it's still loading or speaking.
            const repliedAt = Date.now();
            window.setTimeout(() => {
              if (followUpRef.current && !speakingRef.current && ttsStartedAtRef.current < repliedAt) {
                followUpTriggerRef.current?.();
              }
            }, speakText ? 6000 : 400);

            console.log('[AI PAGE][AIWaiterHome]', { replyText, voiceText, meta });

            // order placed → clear the tray and open the live order page
            if (meta?.decision?.orderPlaced && handleCheckout(meta)) {
              return;
            }

            // a sheet is open: the reply is handled the way that sheet handles it (the list stays, ideas in the
            // tray appear as picks there…) — the voice session talks on every screen, the sheets have no mic
            if (showSuggestionsRef.current) {
              handleSuggestionsReply(undefined, meta, replyText);
              return;
            }
            if (showTrayRef.current) {
              handleTrayReply(undefined, meta, replyText);
              return;
            }

            const intent = resolveIntent(meta, replyText || speakText);
            const decision = (meta?.decision || {}) as any;
            const upsell = (meta?.upsell || (meta as any)?.Upsell || []) || [];

            let cartChanged = false;

            // Unified voice cart ops (clearCart + cartOps) from brain
            if (meta && storeItems && storeItems.length) {
              const hasCartSignal =
                !!meta.clearCart ||
                (Array.isArray((meta as any).cartOps) &&
                  (meta as any).cartOps.length > 0);
              if (hasCartSignal) {
                try {
                  applyVoiceCartOps(meta, storeItems as any[], cartFns);
                  cartChanged = true;
                } catch {
                  // ignore malformed ops
                }
              }
            }

            // read-back / which table? → the checkout page (after any change was applied)
            if (handleCheckout(meta)) {
              // (here the read-back / "which table?" opens the tray on this screen — the session keeps listening
              // for "হ্যাঁ" / "বারো"; a placed order ends it: `ends` above)
              return;
            }

            if (cartChanged) {
              // the missing-item offer ("সাথে কি A অথবা B…?") shows as the waiter's picks — older picks make way
              setTrayPicks([]);
              setUpsellItems(decision?.showUpsellTray && Array.isArray(upsell) && upsell.length ? mapUpsell(upsell) : []);
              setShowTray(true);

              if (!intent || intent === 'order' || intent === 'chitchat') {
                return;
              }
            }

            // Suggestions intent → populate & route
            if (intent === 'suggestions' || decision?.showSuggestionsModal) {
              let mapped = buildSuggestionsFromMeta(meta);
              if ((!mapped || !mapped.length) && replyText) {
                mapped = buildSuggestionsFromReplyText(replyText);
              }
              if (
                (!mapped || !mapped.length) &&
                Array.isArray(storeItems) &&
                storeItems.length
              ) {
                mapped = (storeItems as any[])
                  .slice(0, Math.min(8, storeItems.length))
                  .map((s: any) => ({
                    id: String(s.id),
                    name: s.name,
                    price: typeof s.price === 'number' ? s.price : undefined,
                    imageUrl: s.imageUrl ?? s.image ?? undefined,
                  }));
              }
              setSuggestedItems((mapped || []).filter(Boolean));
              // "ভালো কোনটা হবে?" → the dish the waiter picked is highlighted among the cards
              setHighlightIds(Array.isArray((meta as any)?.highlight) ? (meta as any).highlight.map(String) : []);
              handleIntentRouting('suggestions');
              return;
            }

            // Order intent → add items (fallback when no cartOps), then route
            if (intent === 'order' && menuIndex && meta) {
              const orderItems = Array.isArray(meta.items) ? (meta.items as any[]) : [];
              for (const it of orderItems) {
                let itemId = it.itemId;
                const name = it.name;
                const qty = Math.max(1, Number(it.quantity ?? 1));
                if (!itemId && name) {
                  const found = resolveItemIdByName(menuIndex, name);
                  if (found) itemId = found;
                }
                if (itemId) {
                  const storeItem = storeItems?.find(
                    (s: any) => String(s.id) === String(itemId),
                  );
                  const priceFromStore =
                    typeof storeItem?.price === 'number' ? storeItem.price : undefined;
                  const priceFromMeta =
                    typeof it.price === 'number' ? it.price : undefined;
                  const price = priceFromStore ?? priceFromMeta ?? 0;
                  addItem({
                    id: String(itemId),
                    name: (storeItem as any)?.name ?? name ?? '',
                    price,
                    qty,
                  });
                }
              }

              if (decision?.showUpsellTray && Array.isArray(upsell) && upsell.length) {
                setUpsellItems(mapUpsell(upsell));
              } else {
                setUpsellItems([]);
              }

              handleIntentRouting('order');
              return;
            }

            // Non-order/suggestion but backend wants upsell tray
            if (decision?.showUpsellTray && Array.isArray(upsell) && upsell.length) {
              setUpsellItems(mapUpsell(upsell));
              setShowTray(true);
              return;
            }

            // Everything else
            handleIntentRouting(pageIntent(intent, meta));
            return;
          }

          if (msg.t === 'ai_reply_error') {
            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(false);
            giveUpWaiting();
            return;
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        // silent
      };

      ws.onclose = () => {
        // closed without a reply while we were showing "Thinking…" → recover instead of hanging
        giveUpWaiting();
        // an older utterance's socket closing must not stop a newer recording
        if (wsRef.current && wsRef.current !== ws) return;
        setListening(false);
        pendingFinalResolverRef.current?.(false);
        pendingFinalResolverRef.current = null;
        pendingAiResolverRef.current?.(false);
        pendingAiResolverRef.current = null;
        // the connection dropped (or never opened — e.g. the voice service is restarting) while the mic was
        // still live: release the mic and the dead socket, otherwise every later mic press is ignored
        if (!stoppingRef.current) {
          const neverOpened = !opened;
          void stopListening({ quiet: true }); // no reply is coming — not "Thinking…"
          try {
            setAi(
              selectedLang === 'en'
                ? 'Connection lost — please tap the mic and try again.'
                : neverOpened
                  ? 'এই মুহূর্তে সংযোগ হচ্ছে না — কয়েক সেকেন্ড পরে আবার মাইক চাপুন।'
                  : 'সংযোগ বিচ্ছিন্ন হয়েছে — আবার মাইক চাপুন।',
            );
          } catch {}
        }
      };

      if (node && src) {
        (node.port as MessagePort).onmessage = (ev) => {
          if (stoppingRef.current) return;
          const msg = ev.data;
          if (msg && msg.type === 'chunk' && msg.samples && msg.samples.buffer) {
            const ab = msg.samples.buffer as ArrayBuffer;
            if (ws.readyState === WebSocket.OPEN && helloSentRef.current) {
              ws.send(ab);
            } else if (pendingAudioRef.current.length < PENDING_AUDIO_MAX) {
              pendingAudioRef.current.push(ab); // sent right after the hello — the first syllable isn't lost
            }
          }
        };
        src.connect(node);
      }
    } catch {
      // the mic couldn't open (blocked, iOS said no): nothing was sent, so no "Thinking…" — close quietly
      stopListening({ quiet: true });
    }
  }

  // `serverEnded`: the server already heard the guest finish (hands-free) — don't send "end", just wait for the
  // reply. `quiet`: nobody answered a listen window — close everything, no reply expected, no message.
  async function stopListening(opts?: { serverEnded?: boolean; quiet?: boolean }) {
    const hadSocket = !!wsRef.current; // something was being sent → a reply is on its way
    stoppingRef.current = true;
    setFollowListen(false);

    // Tell backend we're done, but don't block on replies
    try {
      if (!opts?.serverEnded && !opts?.quiet && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const sid = getStableSessionId();
        wsRef.current.send(JSON.stringify({ t: 'end', sid }));
      }
    } catch {
      // ignore
    }
    if (opts?.quiet && wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        ws.close();
      } catch {}
    }

    // Stop mic level loop
    try {
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    } catch {}
    levelRafRef.current = null;

    // Tear down analyser
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    timeDataRef.current = null;
    setMicLevel(0);

    // Tear down audio graph
    try {
      sourceRef.current?.disconnect();
    } catch {}
    sourceRef.current = null;

    try {
      if (nodeRef.current?.port) {
        try {
          nodeRef.current.port.close();
        } catch {}
      }
      nodeRef.current?.disconnect();
    } catch {}
    nodeRef.current = null;

    // Stop media tracks
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    // Suspend (not close) the AudioContext: it was started by a tap, so it can be resumed later without one —
    // that's what lets the mic reopen by itself after the waiter's question (iOS)
    try {
      await ctxRef.current?.suspend();
    } catch {}
    ctxRef.current = null;

    // Keep the socket open for the reply (it closes itself as soon as ai_reply arrives).
    // Replies usually take 4–8 s, longer when the answer is double-checked — only a stuck
    // server hits this safety limit, and then the UI recovers (see giveUpWaiting).
    try {
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null; // ✅ clear ref so mic can restart next time
        setTimeout(() => {
          try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
          } catch {}
        }, REPLY_TIMEOUT_MS);
      }
    } catch {}

    setListening(false);
    // a turn was sent (the server heard them finish, or they tapped / released to send) → "Thinking…" RIGHT AWAY,
    // not a blank moment until the transcript comes back. (Quiet = nothing sent → idle.) If no reply ever comes,
    // giveUpWaiting / the socket timeout bring it back to idle.
    const replyComing = !opts?.quiet && (opts?.serverEnded || hadSocket);
    if (replyComing) awaitingReplyRef.current = true;
    setUiMode(replyComing ? 'thinking' : 'idle');
  }

  // hands-free: when the waiter finishes SPEAKING a question, reopen the mic for the answer (see the TTS onEnd)
  const followUpTriggerRef = useRef<() => void>(() => {});
  followUpTriggerRef.current = () => {
    if (!followUpRef.current) return;
    const askedAt = followUpAtRef.current;
    followUpRef.current = false;
    window.setTimeout(() => {
      if (sessionRef.current !== 'on') return; // muted / ended meanwhile
      if (wsRef.current || ctxRef.current) return;
      if (document.visibilityState !== 'visible' || Date.now() - askedAt > 60_000) return;
      void startRef.current?.({ listenMs: FOLLOW_UP_LISTEN_MS });
    }, 350); // let the speaker's last syllable die away first
  };
  const startRef = useRef(startListening);
  startRef.current = startListening;

  // the pill's controls
  function muteSession() {
    followUpRef.current = false;
    setSession('paused');
    if (wsRef.current || ctxRef.current) void stopListening({ quiet: true });
    earcon('pause');
  }
  function resumeSession() {
    emptyWindowsRef.current = 0;
    setSession('on');
    sessionRef.current = 'on';
    try {
      tts.stop();
    } catch {}
    if (!wsRef.current && !ctxRef.current) void startListening({ listenMs: FOLLOW_UP_LISTEN_MS });
  }

  // what the pill shows
  const voiceState: VoiceState =
    session === 'paused'
      ? 'paused'
      : listening
      ? followListen
        ? 'listening'
        : 'hearing'
      : speaking
      ? 'speaking'
      : uiMode === 'thinking' || voicePending
      ? 'thinking'
      : 'waiting';

  // safety net: the session must never sit on "এক মুহূর্ত…" — on, but nothing listening / thinking / speaking for
  // 8 s → hand the turn back to the guest (a missed reopen can't strand them)
  useEffect(() => {
    if (session !== 'on' || listening || speaking || voicePending || uiMode === 'thinking') return;
    const t = window.setTimeout(() => {
      if (sessionRef.current !== 'on' || wsRef.current || ctxRef.current || speakingRef.current) return;
      console.warn('[voice] session idle with nothing happening → listening again');
      void startRef.current?.({ listenMs: FOLLOW_UP_LISTEN_MS });
    }, 8000);
    return () => window.clearTimeout(t);
  }, [session, listening, speaking, voicePending, uiMode]);

  // leaving the page: the kept audio context is really closed
  useEffect(() => {
    return () => {
      followUpRef.current = false;
      try {
        void persistCtxRef.current?.close();
      } catch {}
      persistCtxRef.current = null;
    };
  }, []);

  // UI mapping
  const bg = '#FFF8FA';
  const orbMode: 'idle' | 'listening' | 'thinking' | 'talking' =
    speaking
      ? 'talking'
      : listening
      ? 'listening'
      : uiMode === 'thinking' || voicePending
      ? 'thinking'
      : 'idle';

  const ORB_SIZE = 480;

  // the waiter's presence at the top of the sheets: live orb · "AI Assistant" · what it's doing (tap = pause/resume)
  const assistantHeader = hasInteracted ? (
    <AssistantHeader
      mode={session === 'on' ? orbMode : 'idle'}
      level={listening ? micLevel : 0}
      paused={session !== 'on'}
      lang={selectedLang === 'en' ? 'en' : 'bn'}
      status={VOICE_STATUS[session === 'on' ? voiceState : 'paused'][1] /* status words stay English */}
      onToggle={session === 'on' ? muteSession : session === 'paused' ? resumeSession : () => void startListening()}
      choices={choices}
      onChoose={(say) => void startListening({ typed: say })}
    />
  ) : undefined;

  const orbRef = useRef<HTMLDivElement | null>(null);
  const micBtnRef = useRef<HTMLButtonElement | null>(null);
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
      if (!orbRef.current || !micBtnRef.current || !textWrapRef.current) return;

      const orbRect = orbRef.current.getBoundingClientRect();
      const micRect = micBtnRef.current.getBoundingClientRect();
      const scrollY =
        window.scrollY || document.documentElement.scrollTop || 0;

      const orbContainerSize = orbRect.height;
      const actualCircleSize = orbContainerSize * 0.44;
      const circlePadding = (orbContainerSize - actualCircleSize) / 2;

      const orbBottomY = orbRect.top + scrollY + circlePadding + actualCircleSize;
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
  }, [visibleText]);

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
        className="fixed right-4 z-[1600]"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <LangSwitch value={selectedLang} onChange={setSelectedLang} />
      </div>

      {/* ORB */}
      <div
        ref={orbRef}
        className="absolute left-1/2 -translate-x-1/2 z-0 pointer-events-none"
        style={{ top: '0px' }}
      >
        <VoiceOrb mode={orbMode} size={ORB_SIZE} level={listening ? micLevel : 0} />
      </div>

      {/* Text */}
      <div
        ref={textWrapRef}
        className="absolute left-1/2 -translate-x-1/2 z-10 w-full max-w-[900px] px-6 text-center pointer-events-auto"
        style={{ top: textTop ?? '50vh' }}
      >
        <SwipeViewport text={visibleText} showCursor={!!aiLive} />

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
                onClick={() => void startListening({ typed: c.say })}
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
        <div className="relative flex items-end justify-center gap-12 px-6 w-full max-w-[520px]">
          {/* Left: Chat (visual only for now) */}
          <button
            className="group relative h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              boxShadow:
                '0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
            }}
            aria-label="Chat"
            title="Chat"
          >
            <div
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'linear-gradient(135deg, rgba(250, 40, 81, 0.08), rgba(250, 40, 81, 0.02))',
              }}
            />
            <img
              src="/icons/Chat.svg"
              alt=""
              draggable={false}
              className="relative z-10 h-[26px] w-[26px]"
            />
          </button>

          {/* Center: Mic */}
          <button
            ref={micBtnRef}
            onClick={(e) => {
              // in a conversation the button is PAUSE (the orb shows listening / thinking / speaking). Judged by the
              // state when the finger went DOWN — a tap that just started the conversation must not pause it.
              if (pressSessionRef.current === 'on') {
                e.preventDefault();
                (window as any).__qravyPTTHandled = false;
                muteSession();
                return;
              }
              if ((window as any).__qravyPTTHandled) {
                (window as any).__qravyPTTHandled = false;
                e.preventDefault();
                return;
              }
              if (listening) {
                stopListening();
              } else {
                startListening();
              }
            }}
            onPointerDown={() => {
              pressSessionRef.current = sessionRef.current;
              if (sessionRef.current === 'on') return; // (the click pauses)
              (window as any).__qravyPTTActive = true;
              (window as any).__qravyPTTHandled = true;
              if (!listening) startListening();
            }}
            onPointerUp={() => {
              if ((window as any).__qravyPTTActive) {
                (window as any).__qravyPTTActive = false;
                if (listening) stopListening(); // held to talk, released → send (a quick tap isn't listening yet)
              }
            }}
            onPointerLeave={() => {
              if ((window as any).__qravyPTTActive) {
                (window as any).__qravyPTTActive = false;
                if (listening) stopListening();
              }
            }}
            onPointerCancel={() => {
              if ((window as any).__qravyPTTActive) {
                (window as any).__qravyPTTActive = false;
                if (listening) stopListening();
              }
            }}
            className="group relative h-24 w-24 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 -mb-1 select-none touch-none"
            style={{
              background: listening
                ? 'linear-gradient(135deg, #FA2851 0%, #FF5470 100%)'
                : 'linear-gradient(135deg, #FA2851 0%, #FF3D5C 100%)',
              boxShadow: listening
                ? '0 16px 48px rgba(250, 40, 81, 0.4), 0 8px 16px rgba(250, 40, 81, 0.25), inset 0 -2px 8px rgba(0, 0, 0, 0.15)'
                : '0 12px 40px rgba(250, 40, 81, 0.35), 0 6px 12px rgba(250, 40, 81, 0.2), inset 0 -2px 8px rgba(0, 0, 0, 0.1)',
            }}
            aria-label={session === 'on' ? 'Pause the conversation' : listening ? 'Stop voice' : 'Start voice'}
            title={session === 'on' ? 'Pause' : listening ? 'Release to stop' : 'Hold to talk • Tap to start'}
          >
            {session === 'on' ? (
              // a conversation is running: this button pauses it (the orb above shows what's happening)
              <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" className="relative z-10 drop-shadow-md" aria-hidden="true">
                <rect x="6.5" y="5" width="4" height="14" rx="1.5" />
                <rect x="13.5" y="5" width="4" height="14" rx="1.5" />
              </svg>
            ) : !listening ? (
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="#fff"
                className="relative z-10 drop-shadow-md"
                aria-hidden="true"
              >
                <path d="M12 2C10.34 2 9 3.34 9 5V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V5C15 3.34 13.66 2 12 2Z" />
                <path d="M19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7C7 13.76 9.24 16 12 16C14.76 16 17 13.76 17 11H19Z" />
              </svg>
            ) : (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="#fff"
                className="relative z-10 drop-shadow-md"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
            )}
          </button>

          {/* Right: Menu */}
          <button
            className="group relative h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              boxShadow:
                '0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
            }}
            aria-label="Menu"
            title="Menu"
            onClick={() => navigate(seeMenuHref)}
          >
            <div
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'linear-gradient(135deg, rgba(250, 40, 81, 0.08), rgba(250, 40, 81, 0.02))',
              }}
            />
            <img
              src="/icons/Dish.svg"
              alt=""
              draggable={false}
              className="relative z-10 h-[26px] w-[26px]"
            />
          </button>
        </div>
      </div>

      {/* Modals: consume lastMeta (with fallback) and apply cartOps */}
      <SuggestionsModal
        open={showSuggestions}
        onClose={() => {
          setShowSuggestions(false);
          setHighlightIds([]);
        }}
        items={suggestedItems}
        highlightIds={highlightIds}
        voiceBar={false /* the voice session talks here — its presence is the header */}
        assistant={assistantHeader}
        onIntent={handleSuggestionsReply}
      />
      <TrayModal
        open={showTray}
        channel={resolvedChannel}
        onClose={() => {
          setShowTray(false);
          setTrayPicks([]);
          setTrayAskTable(false);
          setHighlightIds([]);
        }}
        picks={trayPicks}
        askTable={trayAskTable}
        highlightIds={highlightIds}
        upsellItems={
          lastMeta?.upsell?.length
            ? mapUpsell(lastMeta.upsell as any[])
            : upsellItems
        }
        voiceBar={false /* the voice session talks here — its presence is the header */}
        assistant={assistantHeader}
        onIntent={handleTrayReply}
      />

      {/* THE VOICE SESSION's presence. Home: the big orb IS the status (no panel). A sheet open: the orb shrinks onto
          the sheet's top edge — still listening / thinking / speaking, tap it to pause or resume (sheets have no mic
          of their own). While the mic is really open, the screen's edge glows. */}
      <VoiceEdgeGlow on={listening} level={micLevel} />
      <span className="sr-only" role="status" aria-live="polite">
        {session !== 'off' && !(showSuggestions || showTray)
          ? VOICE_STATUS[voiceState][1]
          : ''}
      </span>

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
      />

      {/* ✅ Glass overlay asking for tap to start (unlocks audio) */}
      {!hasInteracted && (
        <button
          type="button"
          onPointerDown={handleFirstTap}
          className="fixed inset-0 z-[1500] flex flex-col items-center justify-center px-6"
          style={{
            background: 'rgba(255, 255, 255, 0.45)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <div className="max-w-[420px] text-center">
            <p className="text-[28px] md:text-[34px] font-semibold text-[#1F1F1F] mb-3">
              {selectedLang === 'en' ? 'Tap anywhere to start' : 'শুরু করতে যে কোনো জায়গায় ট্যাপ করুন'}
            </p>
          </div>
        </button>
      )}
    </div>
  );
}
