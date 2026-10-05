// apps/tastebud/src/waiter/useWaiterSession.tsx
// THE AI WAITER, ONCE — the voice session (mic, socket, the waiter's voice, hands-free listen windows) and how every
// reply is handled (cart changes, the option picker, offers, suggestion cards, answer pills, the read-back / table /
// details steps). Every page with the waiter (AIWaiterHome, DigitalMenu …) uses this hook + <WaiterSheets/> /
// <WaiterDock/>, so the waiter behaves the same everywhere. Change the waiter's behaviour HERE — never in a page.
// (Moved verbatim from AIWaiterHome, which was the reference behaviour.)
import React, { useRef, useState, useEffect } from 'react';
import { getWsURL, getStableSessionId } from '../utils/ws';
import type { WaiterIntent, AiReplyMeta } from '../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../utils/intent-routing';
import { buildMenuIndex, resolveItemIdByName } from '../utils/item-resolver';
import { useCart } from '../context/CartContext';
import { usePublicMenu } from '../hooks/usePublicMenu';
import { useConversationStore } from '../state/conversation';
import { useTTS } from '../state/TTSProvider';
import { applyVoiceCartOps } from '../utils/voice-cart';
import { claimReveal, ownsReveal } from '../state/reveal-owner';
import { useCheckoutFlow } from '../utils/checkout-flow';
import { getTableKey, useTable } from '../utils/table';
import type { Channel } from '../api/storefront';
import { useWaiterLang } from '../utils/waiter-lang';
import {
  FOLLOW_UP_LISTEN_MS, PENDING_AUDIO_MAX, chooseOptionsOf, pickOptionsOf, handsFreeOn, type ChooseOption, type PickOption,
} from '../utils/handsfree';
import { earcon } from '../utils/earcon';

export type VoiceState = 'listening' | 'hearing' | 'thinking' | 'speaking' | 'waiting' | 'paused';
export const VOICE_STATUS: Record<VoiceState, [string, string]> = {
  listening: ['শুনছি… বলুন', 'Listening… go ahead'],
  hearing: ['শুনছি…', 'Listening…'],
  thinking: ['ভাবছি…', 'Thinking…'],
  speaking: ['বলছি…', 'Speaking…'],
  waiting: ['এক মুহূর্ত…', 'One moment…'],
  paused: ['থামানো — ট্যাপ করে বলুন', 'Paused — tap to talk'],
};

type UIMode = 'idle' | 'thinking' | 'talking';

// 🔒 Welcome overlay persistence (the home screen's "tap to start"): any talk to the waiter counts as activity
export const WELCOME_INTERACT_KEY = 'qravy:aiwaiter:lastInteractionAt';
export const WELCOME_INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes

export function markWelcomeInteraction() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WELCOME_INTERACT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** How long to keep an utterance's socket open for the reply before giving up (safety net only). */
const REPLY_TIMEOUT_MS = 30_000;

export type WaiterSessionOptions = {
  /** the restaurant (subdomain), its branch and the order channel */
  subdomain: string;
  branch?: string;
  channel: Channel;
  /** "show me the menu" — the home screen opens the menu page; the menu page has nothing to open */
  onOpenMenu?: () => void;
  /** the read-back / "which table?" / contact-details step: by default the tray opens (it is the checkout); the
   *  checkout page IS the checkout, so it points at its own fields instead (askTable: the table / details field) */
  onCheckoutStep?: (askTable: boolean) => void;
};

export function useWaiterSession({ subdomain, branch, channel, onOpenMenu, onCheckoutStep }: WaiterSessionOptions) {
  const resolvedSub = subdomain;
  const resolvedBranch = branch;
  const resolvedChannel = channel;
  const channelRef = useRef(resolvedChannel);
  channelRef.current = resolvedChannel;
  const onOpenMenuRef = useRef(onOpenMenu);
  onOpenMenuRef.current = onOpenMenu;
  const onCheckoutStepRef = useRef(onCheckoutStep);
  onCheckoutStepRef.current = onCheckoutStep;

  const setAi = useConversationStore((s: any) => s.setAi);
  const startTtsReveal = useConversationStore((s: any) => s.startTtsReveal) ?? (() => {});
  const appendTtsReveal = useConversationStore((s: any) => s.appendTtsReveal) ?? (() => {});
  const finishTtsReveal = useConversationStore((s: any) => s.finishTtsReveal) ?? (() => {});
  const aiLive = useConversationStore((s: any) => s.aiTextLive);
  const aiFinal = useConversationStore((s: any) => s.aiText ?? s.ai ?? '');
  const aiAt = useConversationStore((s: any) => (s.aiAt as number) ?? 0); // when aiFinal was set
  const lastMeta = useConversationStore((s: any) => s.lastMeta);
  const setMeta = useConversationStore((s: any) => s.setMeta);

  const tts = useTTS();

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
  const revealIdRef = useRef(Symbol('waiter'));
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

  // checkout steps from the waiter (read-back → checkout page, placed → live order page)
  const [trayAskTable, setTrayAskTable] = useState(false);
  const openTrayForCheckout = React.useMemo(
    () => ({
      openTray: (ask: boolean) => {
        setShowSuggestions(false);
        if (onCheckoutStepRef.current) {
          onCheckoutStepRef.current(ask); // the checkout page: its own fields
          return;
        }
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
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  const followUpRef = useRef(false); // a reply came in → listen when the waiter finishes speaking
  const followUpAtRef = useRef(0);
  const followUpsRef = useRef(0); // listen windows in a row without a tap
  const [followListen, setFollowListen] = useState(false); // a listen window is open ("Listening… just answer")
  const [choices, setChoices] = useState<ChooseOption[]>([]);
  // a dish the waiter holds until its size / choices are picked → a picker at the top of the tray (tap or say it)
  const [pickOptions, setPickOptions] = useState<PickOption[]>([]);
  // the dish the waiter just offered (offers.py) — tapping its card in the tray is "yes"
  const [offerItemIds, setOfferItemIds] = useState<string[]>([]);
  const pendingAudioRef = useRef<ArrayBuffer[]>([]); // audio recorded before the hello went out (first syllable)
  const helloSentRef = useRef(false);
  const persistCtxRef = useRef<AudioContext | null>(null); // kept (suspended) between turns — iOS needs a tap-started one
  const workletCtxRef = useRef<AudioContext | null>(null);

  // the guest's choice (top-right switch) → else the restaurant's default (admin) → else Bangla
  const [selectedLang, setSelectedLang] = useWaiterLang(resolvedSub);

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
  // "show me the menu": the sheets close, then the page decides (home → the menu page; the menu page → stays)
  const goMenu = () => {
    setShowSuggestions(false);
    setShowTray(false);
    onOpenMenuRef.current?.();
  };

  // catalog + cart
  const {
    addItem, setQty, updateQty, removeItem, setNotes, clear, items: cartItems,
    setLineQty, removeLine, setLineNotes, replaceLine, setWarnings,
  } = useCart();
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
        // the suggestions list follows too: "AI suggestions" and "which of these" are about the LATEST picks, never an
        // older list (the drinks from before stayed there while these sat in the tray)
        setSuggestedItems(fresh);
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
  const silentReplyRef = useRef(false); // the reply on its way was asked by a button — its cards only: no text, no voice
  const [lastReplyAt, setLastReplyAt] = useState(0); // the waiter's last spoken reply (the dock grows for it)
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
  // `silent`: a button that asks the waiter something ("AI suggestions") — its reply shows (text + cards) but is
  // never spoken, and the mic doesn't reopen after it: the guest tapped, they didn't start a conversation
  async function startListening(opts?: { listenMs?: number; typed?: string; afterStop?: boolean; silent?: boolean }) {
    const followUp = !!opts?.listenMs;
    const typed = opts?.typed?.trim() || '';
    try {
      // any voice interaction counts as activity for welcome timer
      markWelcomeInteraction();

      // a finished utterance's socket that was never cleared (a tapped answer's, once its reply is in) must not
      // block the mic: holding the orb after tapping "AI suggestions" / a pill did nothing at all
      if (wsRef.current && wsRef.current.readyState >= WebSocket.CLOSING) wsRef.current = null;
      if ((listening && !opts?.afterStop) || wsRef.current || ctxRef.current) return;
      silentReplyRef.current = !!(typed && opts?.silent);
      if (!followUp) {
        followUpRef.current = false; // the guest acted — no pending listen window, and the count starts over
        followUpsRef.current = 0;
        emptyWindowsRef.current = 0;
        // a tap starts (or resumes) the hands-free conversation — not a silent button
        if (handsFreeOn() && !silentReplyRef.current) setSession('on');
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
                tableKey: getTableKey(resolvedSub, tableRef.current) ?? undefined, // its QR key → a verified table
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

        // the hello goes out AT ONCE (the server gives up on a silent connection after 1.2 s). No location is ever
        // asked for — no permission popup for the guest.
        sendHello();

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
            const silent = silentReplyRef.current; // asked by a button: shown, never spoken
            silentReplyRef.current = false;
            // (before its text is set: the dock shows only what was said from this reply on — WaiterSheets)
            if (!silent) setLastReplyAt(Date.now());

            if (speakText && !silent) {
              try {
                tts.stop();
              } catch {}
              markVoicePending(true);
              tts.speak(speakText).catch((err) => {
                console.warn('[AIWaiterHome] TTS speak failed, showing text directly:', err);
                markVoicePending(false);
                setAi(speakText);
              });
            } else if (replyText && !silent) {
              setAi(replyText);
            }
            if (silent) {
              // asked by a button ("AI suggestions"): the cards say it — no sentence shown, nothing spoken
              try {
                tts.stop();
              } catch {}
            }

            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(true);
            setUiMode('talking');

            setMeta(meta ?? null);
            // the waiter's flags on the tray (sold out, allergy clash) — every reply, not only when it changes the tray
            if (Array.isArray((meta as any)?.cartWarnings)) setWarnings((meta as any).cartWarnings);
            // "which one?" → the answers as buttons under the question
            // a dish waiting for its size / choices → the tray's picker instead (every reply says what's still waiting)
            const picks = pickOptionsOf(meta);
            setPickOptions(picks);
            const offer = (meta as any)?.upsellOffer;
            setOfferItemIds(Array.isArray(offer?.item_ids) ? offer.item_ids.map(String) : []);
            setChoices(picks.length ? [] : chooseOptionsOf(meta));
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
            followUpRef.current = sessionRef.current === 'on' && emptyWindowsRef.current < 2 && !ends && !silent;
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
            // "3 Onion Rings added — Hot Wings: which size, how spicy?" → the tray, with what was added AND the picker
            if (picks.length && !showTrayRef.current) {
              if (meta && storeItems && storeItems.length) {
                try {
                  applyVoiceCartOps(meta, storeItems as any[], cartFns);
                } catch {
                  // ignore malformed ops
                }
              }
              openTray();
              return;
            }
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
        // this utterance is over (a tapped answer's socket closes right after its reply): free the mic for the next
        if (wsRef.current === ws) wsRef.current = null;
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
  // a tapped answer (the tray's picker, "which one?" buttons): an open listen window (hands-free) is closed quietly
  // first — otherwise the tap was dropped while the mic waited for the guest to speak
  async function sendTyped(say: string, opts?: { silent?: boolean }) {
    const open = listening || !!wsRef.current || !!ctxRef.current;
    if (open && !awaitingReplyRef.current) await stopListening({ quiet: true });
    await startListening({ typed: say, afterStop: open, silent: opts?.silent });
  }

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

  // Push-to-talk on the orb: only a HOLD listens (release = send). A tap never opens the mic — it says "Hold to talk".
  const HOLD_MS = 200;
  const orbBallRef = useRef<HTMLButtonElement | null>(null); // the home orb: the popups' orb starts here and travels into their dock
  const holdTimerRef = useRef<number | null>(null);
  const holdingRef = useRef(false); // this hold started the mic
  // the finger is down (past the hold delay): the orb shows "listening" at once — the mic opens a moment later, and
  // in that gap (the voice already stopped) the orb used to look idle and play the talking → idle doze-off
  const [holding, setHolding] = useState(false);
  const stopWhenOpenRef = useRef(false); // released while the mic was still opening → stop the moment it's open
  const [holdHint, setHoldHint] = useState(0); // bumps on every tap → the hint flashes
  const holdHintTimerRef = useRef<number | null>(null);
  const [holdHintOn, setHoldHintOn] = useState(false);
  const [heldOnce, setHeldOnce] = useState(false); // "Hold to Talk" shows until the first hold (then only after a tap)
  const flashHoldHint = () => {
    setHoldHint((n) => n + 1);
    setHoldHintOn(true);
    if (holdHintTimerRef.current) window.clearTimeout(holdHintTimerRef.current);
    holdHintTimerRef.current = window.setTimeout(() => setHoldHintOn(false), 1800);
  };
  const orbPressStart = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // a finger drifting off the orb mid-sentence keeps talking
    } catch {}
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      holdingRef.current = true;
      setHolding(true);
      stopWhenOpenRef.current = false;
      setHoldHintOn(false);
      setHeldOnce(true);
      void startListening();
    }, HOLD_MS);
  };
  const orbPressEnd = () => {
    if (holdTimerRef.current) {
      // let go before the hold kicked in → a tap
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      flashHoldHint();
      return;
    }
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    if (listening) void stopListening();
    else stopWhenOpenRef.current = true;
  };
  useEffect(() => {
    if (listening && stopWhenOpenRef.current) {
      stopWhenOpenRef.current = false;
      void stopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);
  const orbPressProps = {
    onPointerDown: orbPressStart,
    onPointerUp: orbPressEnd,
    onPointerCancel: orbPressEnd,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // holding must not open the long-press menu
  };
  const holdHintText = selectedLang === 'en' ? 'Hold to Talk' : 'চেপে ধরে বলুন';
  const showHoldPill = !listening && (holdHintOn || !heldOnce);

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

  // what the orb shows
  const orbMode: 'idle' | 'listening' | 'thinking' | 'talking' =
    listening || holding
      ? 'listening'
      : speaking
      ? 'talking'
      : uiMode === 'thinking' || voicePending
      ? 'thinking'
      : 'idle';


  return {
    // where the conversation is
    resolvedSub, resolvedBranch, resolvedChannel, selectedLang, setSelectedLang, tts, setAi, setMeta, lastMeta, lastReplyAt,
    isSilentPending: () => silentReplyRef.current,
    aiLive, aiFinal, aiAt, uiMode, speaking, voicePending, welcomePending, setWelcomePending, listening, holding, micLevel,
    session, voiceState, followListen, orbMode,
    // the mic
    startListening, stopListening, sendTyped, orbPressProps, orbBallRef, holdHint, holdHintText, showHoldPill,
    // what's on screen
    choices, pickOptions, offerItemIds, suggestedItems, highlightIds, setHighlightIds, trayPicks, setTrayPicks,
    upsellItems, trayAskTable, setTrayAskTable, showSuggestions, setShowSuggestions, showTray, setShowTray,
    openSuggestions, openTray, goMenu, mapUpsell, handleSuggestionsReply, handleTrayReply,
  };
}

export type WaiterSession = ReturnType<typeof useWaiterSession>;
