// apps/tastebud/src/pages/AiWaiterHome.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useLocation, useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { getWsURL, getStableSessionId } from '../utils/ws';
import MicHalo from '../components/ai-waiter/MicHalo';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/TrayModal';
import type { WaiterIntent, AiReplyMeta } from '../types/waiter-intents';

import { buildMenuIndex, resolveItemIdByName } from '../utils/item-resolver';
import { useCart } from '../context/CartContext';
import { usePublicMenu } from '../hooks/usePublicMenu';
import { useConversationStore } from '../state/conversation';
import { useTTS } from '../state/TTSProvider';

type UIMode = 'idle' | 'thinking' | 'talking';

export default function AiWaiterHome() {
  const navigate = useNavigate();
  const { subdomain, branch, branchSlug } = useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();
  const location = useLocation();

  const appendAi        = useConversationStore((s: any) => s.appendAi);
  const clearAi         = useConversationStore((s: any) => s.clearAi);
  const setAi           = useConversationStore((s: any) => s.setAi);
  const startTtsReveal  = useConversationStore((s: any) => s.startTtsReveal)  ?? (() => {});
  const appendTtsReveal = useConversationStore((s: any) => s.appendTtsReveal) ?? (() => {});
  const finishTtsReveal = useConversationStore((s: any) => s.finishTtsReveal) ?? (() => {});
  const aiLive          = useConversationStore((s: any) => s.aiTextLive);

  const tts = useTTS();

  // ===================== TTS TIMING (ROBUST + GUARDED) =====================
  const WARMUP_MS = 160;
  const MIN_STEP_MS = 80;
  const FALLBACK_STEP_MS = 120;
  const START_PACK_COUNT = 3;

  const anchorSetRef   = useRef(false);
  const baseStartRef   = useRef(0);
  const lastDueRef     = useRef(0);
  const startedTextRef = useRef<string>('');
  const packedCountRef = useRef(0);

  // Generation guards
  const speakGenRef    = useRef(0);     // increments only on the *first* onStart of a speech
  const activeGenRef   = useRef(0);     // the gen we accept
  const inSpeechRef    = useRef(false); // true between first onStart .. onEnd

  const normToken = (raw: string) =>
    String(raw ?? '').replace(/\s+/g, ' ').trim();

  function scheduleAt(due: number, token: string) {
    const w = normToken(token);
    if (!w) return;
    const safeDue = Math.max(due, lastDueRef.current + MIN_STEP_MS, performance.now() + 1);
    lastDueRef.current = safeDue;
    const delay = Math.max(0, safeDue - performance.now());
    setTimeout(() => {
      if (activeGenRef.current !== speakGenRef.current) return; // stale
      try {
        console.debug('[TTS->Store] appendTtsReveal token=', w);
        appendTtsReveal(w);
      } catch {}
    }, delay);
  }

  useEffect(() => {
    console.debug('[TTS] subscribe() set up');
    const unsubscribe = tts.subscribe({
      onStart: (text) => {
        const liveNow = (useConversationStore as any).getState?.().aiTextLive || '';
        const isContinuation = inSpeechRef.current || !!liveNow;

        if (!isContinuation) {
          // true start of a new utterance
          speakGenRef.current += 1;
          activeGenRef.current  = speakGenRef.current;
          inSpeechRef.current   = true;

          console.debug('[TTS] onStart (NEW) text=', text, 'gen=', activeGenRef.current);

          // reset timing anchors
          anchorSetRef.current = false;
          baseStartRef.current = 0;
          lastDueRef.current   = 0;
          packedCountRef.current = 0;
          startedTextRef.current = text || '';

          setTimeout(() => {
            if (activeGenRef.current !== speakGenRef.current) return; // stale
            console.debug('[TTS->Store] startTtsReveal("") gen=', activeGenRef.current);
            try { startTtsReveal(''); } catch {}
            try { console.debug('[Store] setAi("") (clear final banner)'); setAi(''); } catch {}
          }, WARMUP_MS);
        } else {
          // Azure split / chunk continuation: do NOT clear buffers, do NOT bump gen
          console.debug('[TTS] onStart (CONTINUATION) text=', text, 'use existing gen=', speakGenRef.current);
        }
      },

      onWord: (wRaw, offsetMs) => {
        if (activeGenRef.current !== speakGenRef.current) return; // stale
        console.debug('[TTS] onWord token=', wRaw, 'offsetMs=', offsetMs, 'gen=', activeGenRef.current);

        const hasOffset = typeof offsetMs === 'number' && isFinite(offsetMs) && offsetMs >= 0;

        if (!anchorSetRef.current) {
          anchorSetRef.current = true;
          baseStartRef.current = performance.now() + WARMUP_MS;
          const firstDue = baseStartRef.current;
          console.debug('[TTS] first token due@', firstDue);
          scheduleAt(firstDue, wRaw);
          packedCountRef.current = 1;
          return;
        }

        if (packedCountRef.current > 0 && packedCountRef.current < START_PACK_COUNT) {
          const due = lastDueRef.current > 0
            ? lastDueRef.current + MIN_STEP_MS
            : baseStartRef.current + packedCountRef.current * MIN_STEP_MS;
          console.debug('[TTS] packed token due@', due);
          scheduleAt(due, wRaw);
          packedCountRef.current += 1;
          return;
        }

        if (hasOffset) {
          const due = baseStartRef.current + (offsetMs ?? 0);
          console.debug('[TTS] offset token due@', due);
          scheduleAt(due, wRaw);
        } else {
          const due = Math.max(performance.now(), lastDueRef.current + FALLBACK_STEP_MS);
          console.debug('[TTS] fallback token due@', due);
          scheduleAt(due, wRaw);
        }
      },

      onEnd: () => {
        if (!inSpeechRef.current) {
          console.debug('[TTS] onEnd IGNORED (already ended) gen=', activeGenRef.current, 'speakGen=', speakGenRef.current);
          return;
        }

        // Wait for the last scheduled token to flush, then finalize once.
        const myGen = speakGenRef.current;
        const waitMs = Math.max(0, lastDueRef.current - performance.now() + 60); // small buffer
        console.debug('[TTS] onEnd -> will finalize after', waitMs, 'ms gen=', myGen);

        setTimeout(() => {
          // If a new speech started, abort this finalize.
          if (activeGenRef.current !== myGen) return;

          try { finishTtsReveal(); } catch {}
          inSpeechRef.current = false;

          // Invalidate any late timers from this generation.
          speakGenRef.current += 1;
        }, waitMs);
      },

    });
    
    return () => {
      console.debug('[TTS] unsubscribe()');
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts]);
  // =================== END TTS TIMING (ROBUST + GUARDED) ====================

  // Load Noto Sans Bengali
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

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

  const resolvedChannel =
    (typeof window !== 'undefined' ? (window as any).__STORE__?.channel : null) ?? null;

  const seeMenuHref = resolvedBranch ? `/t/${resolvedSub}/${resolvedBranch}/menu` : `/t/${resolvedSub}/menu`;

  // ===== Audio / WS =====
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafLevelRef = useRef<number | null>(null);

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [uiMode, setUiMode] = useState<UIMode>('idle');

  const [selectedLang, setSelectedLang] = useState<'auto' | 'bn' | 'en'>(() => {
    const fromUrl = (search.get('lang') as 'auto' | 'bn' | 'en' | null) || null;
    const fromLs =
      typeof window !== 'undefined' ? ((localStorage.getItem('qravy:lang') as 'auto' | 'bn' | 'en' | null) || null) : null;
    return (fromUrl || fromLs || 'bn') as 'auto' | 'bn' | 'en';
  });

  const broadcastLang = (lang: 'auto' | 'bn' | 'en') => {
    if (typeof window !== 'undefined') {
      (window as any).__WAITER_LANG__ = lang;
      try { window.dispatchEvent(new CustomEvent('qravy:lang', { detail: { lang } } )); } catch {}
      try { document.documentElement.setAttribute('lang', lang === 'bn' ? 'bn' : 'en'); } catch {}
    }
  };

  useEffect(() => { broadcastLang(selectedLang); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('qravy:lang', selectedLang); } catch {}
    }
    console.debug('[Lang] selectedLang ->', selectedLang);
    broadcastLang(selectedLang);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.debug('[WS] send set_lang', selectedLang);
      wsRef.current.send(JSON.stringify({ t: 'set_lang', lang: selectedLang }));
    }
  }, [selectedLang]);

  const stoppingRef = useRef<boolean>(false);

  const finalSeenRef = useRef<boolean>(false);
  const pendingFinalResolverRef = useRef<null | ((ok: boolean) => void)>(null);

  const aiSeenRef = useRef<boolean>(false);
  const pendingAiResolverRef = useRef<null | ((ok: boolean) => void)>(null);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTray, setShowTray] = useState(false);

  const openSuggestions = () => { setShowTray(false); setShowSuggestions(true); };
  const openTray = () => { setShowSuggestions(false); setShowTray(true); };
  const goMenu = () => { setShowSuggestions(false); setShowTray(false); navigate(seeMenuHref); };

  const { addItem } = useCart();
  const { items: storeItems } = usePublicMenu(resolvedSub, resolvedBranch, 'dine-in');
  const [menuIndex, setMenuIndex] = useState<ReturnType<typeof buildMenuIndex> | null>(null);

  useEffect(() => { if (storeItems?.length) setMenuIndex(buildMenuIndex(storeItems)); }, [storeItems]);

  type SuggestedItem = { id?: string; name?: string; price?: number; imageUrl?: string };
  const [suggestedItems, setSuggestedItems] = useState<SuggestedItem[]>([]);

  function handleIntentRouting(intent: WaiterIntent | undefined) {
    if (!intent) return;
    console.debug('[Intent] route', intent, { showSuggestions, showTray });

    if (showSuggestions) {
      if (intent === 'order') return openTray();
      if (intent === 'menu') return goMenu();
      return;
    }

    if (showTray) {
      if (intent === 'menu') return goMenu();
      return;
    }

    if (intent === 'suggestions') return openSuggestions();
    if (intent === 'order') return openTray();
    if (intent === 'menu') return goMenu();
  }

  function waitForFinal(timeoutMs = 8000) {
    if (pendingFinalResolverRef.current) {
      try { pendingFinalResolverRef.current(false); } catch {}
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
        try { clearTimeout(timer); } catch {}
        pendingFinalResolverRef.current = null;
        resolve(ok);
      };
    });
  }

  function waitForAiReply(timeoutMs = 8000) {
    if (pendingAiResolverRef.current) {
      try { pendingAiResolverRef.current(false); } catch {}
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
        try { clearTimeout(timer); } catch {}
        pendingAiResolverRef.current = null;
        resolve(ok);
      };
    });
  }

  const startLevelMeter = (analyser: AnalyserNode) => {
    const timeData = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const scaled = Math.min(1, rms * 2.5);
      setLevel((prev) => prev * 0.8 + scaled * 0.2);
      rafLevelRef.current = requestAnimationFrame(tick);
    };
    if (rafLevelRef.current) cancelAnimationFrame(rafLevelRef.current);
    rafLevelRef.current = requestAnimationFrame(tick);
  };

  const stopLevelMeter = () => {
    if (rafLevelRef.current) cancelAnimationFrame(rafLevelRef.current);
    rafLevelRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  };

  function resolveStoreItemById(id?: string) {
    if (!id) return undefined as any;
    return storeItems?.find((s: any) => String(s?.id) === String(id));
  }

  function mergeFromStore(it: any, itemId?: string): SuggestedItem {
    const storeItem = itemId ? resolveStoreItemById(itemId) : undefined;
    const priceFromStore = typeof (storeItem as any)?.price === 'number' ? (storeItem as any).price : undefined;
    const priceFromMeta = typeof it?.price === 'number' ? it.price : undefined;

    return {
      id: itemId ?? undefined,
      name: (storeItem as any)?.name ?? it?.name ?? undefined,
      price: priceFromStore ?? priceFromMeta,
      imageUrl: (storeItem as any)?.imageUrl ?? (storeItem as any)?.image ?? undefined,
    };
  }

  function buildSuggestionsFromMeta(meta: AiReplyMeta | undefined): SuggestedItem[] {
    if (!menuIndex) return [];
    const out: SuggestedItem[] = [];

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

    const groups: any[] = Array.isArray((meta as any)?.suggestions) ? (meta as any).suggestions : [];
    for (const g of groups) {
      const gItems = Array.isArray(g?.items) ? g.items : [];
      for (const it of gItems) {
        const name = it?.name as string | undefined;
        let itemId = it?.itemId as string | undefined;
        if (!itemId && name) {
          const found = resolveItemIdByName(menuIndex, name);
          if (found) itemId = String(found);
        }
        out.push(mergeFromStore(it, itemId));
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

  async function startListening() {
    try {
      if (listening || wsRef.current || ctxRef.current) return;

      try {
        console.debug('[TTS] stop() before capture');
        tts.stop();
      } catch {}
      console.debug('[Store] clearAi()');
      clearAi();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }

      await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      startLevelMeter(analyser);

      const node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
      nodeRef.current = node;

      const ws = new WebSocket(getWsURL('/ws/voice'));
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        const sid = getStableSessionId();
        stoppingRef.current = false;
        finalSeenRef.current = true;
        aiSeenRef.current = false;

        console.debug('[WS] open -> hello', { sid, lang: selectedLang, resolvedSub, resolvedBranch, resolvedChannel });
        ws.send(JSON.stringify({
          t: 'hello',
          sid,
          sessionId: sid,
          userId: 'guest',
          rate: 16000,
          ch: 1,
          lang: selectedLang,
          tenant: resolvedSub ?? null,
          branch: resolvedBranch ?? null,
          channel: resolvedChannel,
        }));
        setListening(true);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data as string);
          console.debug('[WS<-]', msg);

          if (msg.t === 'stt_final') {
            finalSeenRef.current = true;
            pendingFinalResolverRef.current?.(true);
            return;
          }

          if (msg.t === 'ai_reply_pending') {
            setUiMode('thinking');
            try { console.debug('[Store] setAi("") on pending'); setAi(''); } catch {}
            return;
          }

          if (msg.t === 'ai_reply') {
            const text = (msg.replyText as string) || '';
            console.debug('[AI] final replyText=', text);
            if (text) {
              try { console.debug('[TTS] speak()'); tts.speak(text); } catch {}
            }
            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(true);
            setUiMode('talking');

            const meta: AiReplyMeta | undefined = msg.meta;
            const intent = (meta?.intent ?? 'chitchat') as WaiterIntent;

            if (intent === 'suggestions') {
              let mapped: SuggestedItem[] = [];

              const metaBased = buildSuggestionsFromMeta(meta);
              mapped = metaBased;

              if ((!mapped || mapped.length === 0) && text) {
                mapped = buildSuggestionsFromReplyText(text);
              }

              if ((!mapped || mapped.length === 0) && Array.isArray(storeItems) && storeItems.length) {
                mapped = (storeItems as any[])
                  .slice(0, Math.min(8, storeItems.length))
                  .map((s) => ({
                    id: String(s.id),
                    name: s.name,
                    price: typeof s.price === 'number' ? s.price : undefined,
                    imageUrl: s.imageUrl ?? s.image ?? undefined,
                  }));
              }

              setSuggestedItems(mapped.filter(Boolean));
              openSuggestions();
              return;
            }

            if (intent === 'order' && menuIndex) {
              const items = Array.isArray(meta?.items) ? meta.items : [];
              for (const it of items) {
                let itemId = (it as any).itemId;
                const name = (it as any).name;
                const qty = Math.max(1, Number((it as any).quantity ?? 1));

                if (!itemId && name) {
                  const found = resolveItemIdByName(menuIndex, name);
                  if (found) itemId = found;
                }

                if (itemId) {
                  const storeItem = storeItems.find((s) => String((s as any).id) === String(itemId));
                  const priceFromStore = typeof storeItem?.price === 'number' ? storeItem.price : undefined;
                  const priceFromMeta = typeof (it as any).price === 'number' ? (it as any).price : undefined;
                  const price = priceFromStore ?? priceFromMeta ?? 0;

                  addItem({ id: String(itemId), name: name ?? '', price, qty });
                }
              }
              openTray();
              return;
            }

            handleIntentRouting(intent);
            return;
          }

          if (msg.t === 'ai_reply_error') {
            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(false);
            setUiMode('idle');
            return;
          }
        } catch {}
      };

      ws.onerror = () => { console.warn('[WS] error'); };
      ws.onclose = () => {
        console.debug('[WS] close');
        setListening(false);
        pendingFinalResolverRef.current?.(false);
        pendingFinalResolverRef.current = null;
        pendingAiResolverRef.current?.(false);
        pendingAiResolverRef.current = null;
      };

      (node.port as MessagePort).onmessage = (ev) => {
        if (stoppingRef.current) return;
        const msg = ev.data;
        if (msg && msg.type === 'chunk' && msg.samples && msg.samples.buffer) {
          const ab = msg.samples.buffer as ArrayBuffer;
          if (ws.readyState === WebSocket.OPEN) ws.send(ab);
        }
      };

      src.connect(node);
    } catch (e) {
      console.error(e);
      stopListening();
    }
  }

  async function stopListening() {
    console.debug('[Voice] stopListening()');
    stoppingRef.current = true;
    let gotFinal = finalSeenRef.current;
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const sid = getStableSessionId();
        wsRef.current.send(JSON.stringify({ t: 'end', sid }));
        if (!gotFinal) gotFinal = await waitForFinal(8000);
        if (!aiSeenRef.current) await waitForAiReply(8000);
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (e) {
      console.error(e);
    }

    try { stopLevelMeter(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    try { nodeRef.current?.port.close(); } catch {}
    try { nodeRef.current?.disconnect(); } catch {}
    nodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { await ctxRef.current?.close(); } catch {}
    ctxRef.current = null;
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    setListening(false);
    setUiMode('idle');
  }

  const ACCENT = '#FA2851';
  const bgWhite = '#FFFFFF';
  const bgPink = '#FFF0F3';

  const chipBase = 'px-3 py-1.5 rounded-full text-sm font-medium border transition-all active:scale-95';
  const activeChip = 'bg-[#FA2851] text-white border-[#FA2851] shadow-[0_6px_20px_rgba(250,40,81,0.25)]';
  const inactiveChip = 'bg-white/80 text-gray-700 border-white/70 backdrop-blur hover:bg-white';

  type HaloVisualMode = 'idle' | 'listening' | 'talking';
  const haloVisualMode: HaloVisualMode = uiMode === 'talking' ? 'talking' : listening ? 'listening' : 'idle';

  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-between px-6 pb-20"
      style={{
        fontFamily: `'Noto Sans Bengali', 'Inter', system-ui, sans-serif`,
        background: `linear-gradient(180deg, ${bgWhite} 70%, ${bgPink} 100%)`,
      }}
    >
      {/* UI Controls */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setUiMode((m) => (m === 'thinking' ? 'idle' : 'thinking'))}
          className={`${chipBase} ${uiMode === 'thinking' ? activeChip : inactiveChip}`}
        >
          Thinking
        </button>
        <button
          type="button"
          onClick={() => setUiMode((m) => (m === 'talking' ? 'idle' : 'talking'))}
          className={`${chipBase} ${uiMode === 'talking' ? activeChip : inactiveChip}`}
        >
          Talking
        </button>
      </div>

      {/* Language switcher */}
      <div className="fixed bottom-4 left-4 z-50 flex gap-2">
        {(['auto', 'bn', 'en'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setSelectedLang(l)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              selectedLang === l ? 'bg-[#FA2851] text-white' : 'bg-white/90 text-gray-700 border border-gray-200'
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Main hero — LIVE TTS text area */}
      <div className="pt-40 sm:pt-48 text-left w-full max-w-[400px] min-h-[180px]">
        {aiLive ? (
          <p className="text-[30px] md:text-[40px] leading-[1.6] font-medium text-[#2D2D2D] whitespace-pre-wrap">
            {aiLive}
            <span className="ml-1 animate-pulse">▌</span>
          </p>
        ) : null}
      </div>

      {/* Mic + Menu */}
      <div className="relative flex flex-col items-center justify-center">
        <MicHalo size={600} color={'#FFE9ED'} opacity={0.6} accentColor={'#FA2851'} mode={haloVisualMode} level={level} />
        {!listening ? (
          <button
            onClick={startListening}
            className="relative h-[120px] w-[120px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 z-[2]"
            style={{ background: '#FA2851', boxShadow: '0 8px 24px rgba(250,40,81,0.3)' }}
            aria-label="Start voice"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
              <rect x="9" y="3" width="6" height="10" rx="3" />
              <path d="M5 11a7 7 0 0014 0h-2a5 5 0 01-10 0H5z" />
              <path d="M11 19v2h2v-2h-2z" />
            </svg>
          </button>
        ) : (
          <button
            onClick={stopListening}
            className="relative h-[120px] w-[120px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 z-[2]"
            style={{ background: '#FA2851', boxShadow: '0 8px 24px rgba(250,40,81,0.3)' }}
            aria-label="Stop voice"
          >
            <svg width="42" height="42" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
        )}
        <Link
          to={seeMenuHref}
          className="mt-6 z-[3] px-6 py-3 rounded-full text-[16px] font-medium bg-white/95 text-[#FA2851] border border-white/80 shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-transform duration-300 hover:scale-[1.03] active:scale-95"
        >
          See Menu
        </Link>
      </div>

      {/* Modals */}
      <SuggestionsModal open={showSuggestions} onClose={() => setShowSuggestions(false)} items={suggestedItems} />
      <TrayModal open={showTray} onClose={() => setShowTray(false)} />
    </div>
  );
}
