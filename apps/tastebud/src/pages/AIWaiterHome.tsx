import React, { useRef, useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getWsURL, getStableSessionId } from '../utils/ws';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/TrayModal';
import type { WaiterIntent, AiReplyMeta } from '../types/waiter-intents';

import VoiceOrb from '../components/ai-waiter/VoiceOrb';

import { buildMenuIndex, resolveItemIdByName } from '../utils/item-resolver';
import { useCart } from '../context/CartContext';
import { usePublicMenu } from '../hooks/usePublicMenu';
import { useConversationStore } from '../state/conversation';
import { useTTS } from '../state/TTSProvider';

type UIMode = 'idle' | 'thinking' | 'talking';

/* ------------ touch-swipe 4-line viewport (unchanged core) ------------ */
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
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
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
      <p ref={measureRef} className="text-[30px] md:text-[40px] leading-[1.6] font-medium opacity-0 absolute">A</p>
      <div
        style={{ height: boxH || undefined, overflow: 'hidden', touchAction: 'none', userSelect: 'none', position: 'relative' }}
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

export default function AiWaiterHome() {
  const navigate = useNavigate();
  const { subdomain, branch, branchSlug } = useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();

  const setAi           = useConversationStore((s: any) => s.setAi);
  const startTtsReveal  = useConversationStore((s: any) => s.startTtsReveal)  ?? (() => {});
  const appendTtsReveal = useConversationStore((s: any) => s.appendTtsReveal) ?? (() => {});
  const finishTtsReveal = useConversationStore((s: any) => s.finishTtsReveal) ?? (() => {});
  const aiLive          = useConversationStore((s: any) => s.aiTextLive);
  const aiFinal         = useConversationStore((s: any) => s.aiText ?? s.ai ?? '');

  const tts = useTTS();

  // ===== word-sync (gapless) =====
  const MIN_STEP_MS = 80;
  const FALLBACK_STEP_MS = 120;
  const START_PACK_COUNT = 3;
  const anchorSetRef   = useRef(false);
  const baseStartRef   = useRef(0);
  const lastDueRef     = useRef(0);
  const startedTextRef = useRef<string>('');
  const packedCountRef = useRef(0);
  const speakGenRef    = useRef(0);
  const activeGenRef   = useRef(0);
  const inSpeechRef    = useRef(false);
  const firstTokenRef  = useRef(false);

  const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
  function scheduleAt(due: number, token: string) {
    const w = norm(token); if (!w) return;
    const safeDue = Math.max(due, lastDueRef.current + MIN_STEP_MS, performance.now() + 1);
    lastDueRef.current = safeDue;
    const delay = Math.max(0, safeDue - performance.now());
    setTimeout(() => {
      if (activeGenRef.current !== speakGenRef.current) return;
      try { appendTtsReveal(w); } catch {}
    }, delay);
  }

  // speaking drives orb “talking” state only (no ring sync)
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const un = tts.subscribe({
      onStart: (text) => {
        setSpeaking(true);
        const liveNow = (useConversationStore as any).getState?.().aiTextLive || '';
        const cont = inSpeechRef.current || !!liveNow;
        if (!cont) {
          speakGenRef.current += 1;
          activeGenRef.current  = speakGenRef.current;
          inSpeechRef.current   = true;
          anchorSetRef.current = false;
          baseStartRef.current = 0;
          lastDueRef.current   = 0;
          packedCountRef.current = 0;
          startedTextRef.current = text || '';
          firstTokenRef.current  = false;
          try { startTtsReveal(''); } catch {}
        }
      },
      onWord: (w, off) => {
        if (activeGenRef.current !== speakGenRef.current) return;
        if (!anchorSetRef.current) {
          anchorSetRef.current = true;
          if (!firstTokenRef.current) { try { setAi(''); } catch {}; try { appendTtsReveal(w); } catch {}; firstTokenRef.current = true; }
          baseStartRef.current = performance.now();
          lastDueRef.current   = baseStartRef.current;
          packedCountRef.current = 1;
          return;
        }
        if (packedCountRef.current > 0 && packedCountRef.current < START_PACK_COUNT) {
          const due = lastDueRef.current > 0 ? lastDueRef.current + MIN_STEP_MS : baseStartRef.current + packedCountRef.current * MIN_STEP_MS;
          scheduleAt(due, w); packedCountRef.current += 1; return;
        }
        const hasOff = typeof off === 'number' && isFinite(off) && off >= 0;
        if (hasOff) scheduleAt(baseStartRef.current + (off ?? 0), w);
        else scheduleAt(Math.max(performance.now(), lastDueRef.current + FALLBACK_STEP_MS), w);
      },
      onEnd: () => {
        if (!inSpeechRef.current) return;
        const myGen = speakGenRef.current;
        const wait = Math.max(0, lastDueRef.current - performance.now() + 80);
        setTimeout(() => {
          if (activeGenRef.current !== myGen) return;
          try { finishTtsReveal(); } catch {}
          try {
            const st = (useConversationStore as any).getState?.() || {};
            const finalText = (st.aiTextLive && String(st.aiTextLive).trim())
              ? String(st.aiTextLive) : String(startedTextRef.current || '');
            setAi(finalText);
          } catch {}
          inSpeechRef.current = false;
          speakGenRef.current += 1;
          setSpeaking(false);
        }, wait);
      },
    });
    return () => un();
  }, [tts]);

  // fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // routing/state
  const resolvedSub =
    subdomain ?? search.get('subdomain') ?? (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : null) ?? 'demo';
  const resolvedBranch =
    branch ?? branchSlug ?? search.get('branch') ?? (typeof window !== 'undefined' ? (window as any).__STORE__?.branch : null) ?? undefined;
  const resolvedChannel =
    (typeof window !== 'undefined' ? (window as any).__STORE__?.channel : null) ?? null;

  const seeMenuHref = resolvedBranch ? `/t/${resolvedSub}/${resolvedBranch}/menu` : `/t/${resolvedSub}/menu`;

  // ws/audio
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // analyser + mic level
  const analyserRef = useRef<AnalyserNode | null>(null);
  // 🔐 pin typing to avoid TS2345
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const levelRafRef = useRef<number | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const [listening, setListening] = useState(false);
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
  useEffect(() => { broadcastLang(selectedLang); }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') { try { localStorage.setItem('qravy:lang', selectedLang); } catch {} }
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
  const openSuggestions = () => { setShowTray(false); setShowSuggestions(true); };
  const openTray = () => { setShowSuggestions(false); setShowTray(true); };
  const goMenu = () => { setShowSuggestions(false); setShowTray(false); navigate(seeMenuHref); };

  // catalog
  const { addItem } = useCart();
  const { items: storeItems } = usePublicMenu(resolvedSub, resolvedBranch, 'dine-in');
  const [menuIndex, setMenuIndex] = useState<ReturnType<typeof buildMenuIndex> | null>(null);
  useEffect(() => { if (storeItems?.length) setMenuIndex(buildMenuIndex(storeItems)); }, [storeItems]);

  type SuggestedItem = { id?: string; name?: string; price?: number; imageUrl?: string };
  const [suggestedItems, setSuggestedItems] = useState<SuggestedItem[]>([]);

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
      if (!itemId && name) { const found = resolveItemIdByName(menuIndex, name); if (found) itemId = String(found); }
      out.push(mergeFromStore(it, itemId));
    }
    const groups: any[] = Array.isArray((meta as any)?.suggestions) ? (meta as any).suggestions : [];
    for (const g of groups) {
      const gItems = Array.isArray(g?.items) ? g.items : [];
      for (const it of gItems) {
        const name = it?.name as string | undefined;
        let itemId = it?.itemId as string | undefined;
        if (!itemId && name) { const found = resolveItemIdByName(menuIndex, name); if (found) itemId = String(found); }
        out.push(mergeFromStore(it, itemId));
      }
    }
    const seen = new Set<string>();
    return out.filter((x) => { const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  function buildSuggestionsFromReplyText(replyText: string): SuggestedItem[] {
    if (!replyText || !storeItems?.length) return [];
    const lc = replyText.toLowerCase();
    const hits: SuggestedItem[] = [];
    for (const s of storeItems as any[]) {
      const name = (s?.name ?? '').toString(); if (!name) continue;
      const nameHit = lc.includes(name.toLowerCase());
      const aliases: string[] = Array.isArray(s?.aliases) ? s.aliases : [];
      const aliasHit = aliases.some((a) => lc.includes(a.toLowerCase()));
      if (nameHit || aliasHit) hits.push({ id: String(s.id), name: s.name, price: typeof s.price === 'number' ? s.price : undefined, imageUrl: s.imageUrl ?? s.image ?? undefined });
    }
    const seen = new Set<string>();
    return hits.filter((x) => { const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }

  function handleIntentRouting(intent: WaiterIntent | undefined) {
    if (!intent) return;
    if (showSuggestions) { if (intent === 'order') return openTray(); if (intent === 'menu') return goMenu(); return; }
    if (showTray) { if (intent === 'menu') return goMenu(); return; }
    if (intent === 'suggestions') return openSuggestions();
    if (intent === 'order') return openTray();
    if (intent === 'menu') return goMenu();
  }

  // small gates
  function waitForFinal(timeoutMs = 8000) {
    if (pendingFinalResolverRef.current) { try { pendingFinalResolverRef.current(false); } catch {}; pendingFinalResolverRef.current = null; }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { if (pendingFinalResolverRef.current) { pendingFinalResolverRef.current(false); pendingFinalResolverRef.current = null; } resolve(false); }, timeoutMs);
      pendingFinalResolverRef.current = (ok: boolean) => { try { clearTimeout(timer); } catch {}; pendingFinalResolverRef.current = null; resolve(ok); };
    });
  }
  function waitForAiReply(timeoutMs = 8000) {
    if (pendingAiResolverRef.current) { try { pendingAiResolverRef.current(false); } catch {}; pendingAiResolverRef.current = null; }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { if (pendingAiResolverRef.current) { pendingAiResolverRef.current(false); pendingAiResolverRef.current = null; } resolve(false); }, timeoutMs);
      pendingAiResolverRef.current = (ok: boolean) => { try { clearTimeout(timer); } catch {}; pendingAiResolverRef.current = null; resolve(ok); };
    });
  }

  async function startListening() {
    try {
      if (listening || wsRef.current || ctxRef.current) return;
      try { tts.stop(); } catch {}
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
      await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;
      const node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
      nodeRef.current = node;

      // analyser
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.08;
      analyserRef.current = analyser;
      src.connect(analyser);

      // pinned buffer to satisfy TS2345
      const backing = new ArrayBuffer(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(backing) as Uint8Array<ArrayBuffer>;

      const levelLoop = () => {
        if (!analyserRef.current || !timeDataRef.current) return;
        analyserRef.current.getByteTimeDomainData(timeDataRef.current as Uint8Array<ArrayBuffer>);
        const buf = new Uint8Array((timeDataRef.current as any).buffer as ArrayBuffer);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const noiseFloor = 0.02;
        const norm = Math.max(0, (rms - noiseFloor) / (1 - noiseFloor));
        const clamped = Math.min(0.9, norm);
        setMicLevel(clamped);
        levelRafRef.current = requestAnimationFrame(levelLoop);
      };
      levelRafRef.current = requestAnimationFrame(levelLoop);

      const ws = new WebSocket(getWsURL('/ws/voice'));
      wsRef.current = ws; ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        const sid = getStableSessionId();
        stoppingRef.current = false; finalSeenRef.current = true; aiSeenRef.current = false;
        ws.send(JSON.stringify({ t: 'hello', sid, sessionId: sid, userId: 'guest', rate: 16000, ch: 1, lang: selectedLang,
          tenant: subdomain ?? 'demo', branch: branch ?? branchSlug ?? null, channel: resolvedChannel }));
        setListening(true);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.t === 'stt_final') { finalSeenRef.current = true; pendingFinalResolverRef.current?.(true); return; }
          if (msg.t === 'ai_reply_pending') { setUiMode('thinking'); return; }
          if (msg.t === 'ai_reply') {
            const text = (msg.replyText as string) || '';
            if (text) try { tts.speak(text); } catch {}
            aiSeenRef.current = true; pendingAiResolverRef.current?.(true); setUiMode('talking');

            const meta: AiReplyMeta | undefined = msg.meta;
            const intent = (meta?.intent ?? 'chitchat') as WaiterIntent;

            if (intent === 'suggestions') {
              let mapped: SuggestedItem[] = [];
              mapped = buildSuggestionsFromMeta(meta);
              if ((!mapped || mapped.length === 0) && text) mapped = buildSuggestionsFromReplyText(text);
              if ((!mapped || mapped.length === 0) && Array.isArray(storeItems) && storeItems.length) {
                mapped = (storeItems as any[]).slice(0, Math.min(8, storeItems.length)).map((s) => ({
                  id: String(s.id), name: s.name, price: typeof s.price === 'number' ? s.price : undefined, imageUrl: s.imageUrl ?? s.image ?? undefined,
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
                if (!itemId && name) { const found = resolveItemIdByName(menuIndex, name); if (found) itemId = found; }
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
          if (msg.t === 'ai_reply_error') { aiSeenRef.current = true; pendingAiResolverRef.current?.(false); setUiMode('idle'); return; }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        setListening(false);
        pendingFinalResolverRef.current?.(false); pendingFinalResolverRef.current = null;
        pendingAiResolverRef.current?.(false); pendingAiResolverRef.current = null;
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
    } catch (e) { console.error(e); }

    try { if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current); } catch {}
    levelRafRef.current = null;
    try { analyserRef.current?.disconnect(); } catch {}
    analyserRef.current = null;
    timeDataRef.current = null;
    setMicLevel(0);

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

  // UI mapping
  const bg = '#FFF8FA';
  const orbMode: 'idle' | 'listening' | 'thinking' | 'talking' =
    speaking ? 'talking'
    : (listening ? 'listening' : (uiMode === 'thinking' ? 'thinking' : 'idle'));

  const ORB_SIZE = 480;
  const MIC_OUTER = 120;
  const MIC_INNER = 92;

  const orbRef = useRef<HTMLDivElement | null>(null);
  const micRingRef = useRef<HTMLDivElement | null>(null);
  const micBtnRef = useRef<HTMLButtonElement | null>(null);
  const textWrapRef = useRef<HTMLDivElement | null>(null);
  const [textTop, setTextTop] = useState<number | null>(null);

  const visibleText = (aiLive || aiFinal) ?? '';

  useEffect(() => {
    let rafA = 0;
    const placeText = () => {
      if (!orbRef.current || !micBtnRef.current || !textWrapRef.current) return;
      const orbRect = orbRef.current.getBoundingClientRect();
      const micRect = micBtnRef.current.getBoundingClientRect();
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

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
    rafA = requestAnimationFrame(placeText);
    window.addEventListener('resize', placeText);
    const ro = new ResizeObserver(placeText);
    if (textWrapRef.current) ro.observe(textWrapRef.current);
    return () => {
      cancelAnimationFrame(rafA);
      window.removeEventListener('resize', placeText);
      ro.disconnect();
    };
  }, [visibleText]);

  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-between px-6"
      style={{ fontFamily: `'Noto Sans Bengali', 'Inter', system-ui, sans-serif`, background: bg }}
    >
      {/* ORB near top center */}
      <div
        ref={orbRef}
        className="absolute left-1/2 -translate-x-1/2 z-0 pointer-events-none"
        style={{ top: '0px' }}
      >
        {/* level only while listening; talking animation is independent */}
        <VoiceOrb mode={orbMode} size={ORB_SIZE} level={listening ? micLevel : 0} />
      </div>

      {/* Text layer */}
      <div
        ref={textWrapRef}
        className="absolute left-1/2 -translate-x-1/2 z-[999] w-full max-w-[900px] px-6 text-center pointer-events-auto"
        style={{ top: textTop ?? '50vh' }}
      >
        <SwipeViewport text={visibleText} showCursor={!!aiLive} />
      </div>

      {/* Bottom cluster - Three floating buttons (tap-to-toggle; hold = push-to-talk) */}
      <div className="fixed bottom-0 left-0 right-0 flex items-end justify-center pb-10 md:pb-12">
        <div className="relative flex items-end justify-center gap-12 px-6 w-full max-w-[520px]">

          {/* Left: Chat button */}
          <button
            className="group relative h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
            style={{ 
              background: 'rgba(255, 255, 255, 0.95)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.4)'
            }}
            aria-label="Chat"
            title="Chat"
          >
            <div 
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{ background: 'linear-gradient(135deg, rgba(250, 40, 81, 0.08), rgba(250, 40, 81, 0.02))' }}
            />
            <img
              src="/icons/Chat.svg"
              alt=""
              draggable={false}
              className="relative z-10 h-[26px] w-[26px]"
            />
          </button>

          {/* Center: Mic button - Hero (tap to toggle; hold = push-to-talk) */}
          <button
            ref={micBtnRef}
            // ── TAP: toggle
            onClick={(e) => {
              if ((window as any).__qravyPTTHandled) {
                (window as any).__qravyPTTHandled = false;
                e.preventDefault();
                return;
              }
              listening ? stopListening() : startListening();
            }}
            // ── HOLD: push-to-talk via Pointer Events
            onPointerDown={() => {
              (window as any).__qravyPTTActive = true;
              (window as any).__qravyPTTHandled = true; // suppress the click that follows a hold
              if (!listening) startListening();
            }}
            onPointerUp={() => {
              if ((window as any).__qravyPTTActive) {
                (window as any).__qravyPTTActive = false;
                if (listening) stopListening();
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
                : '0 12px 40px rgba(250, 40, 81, 0.35), 0 6px 12px rgba(250, 40, 81, 0.2), inset 0 -2px 8px rgba(0, 0, 0, 0.1)'
            }}
            aria-label={listening ? "Stop voice" : "Start voice"}
            title={listening ? "Release to stop" : "Hold to talk • Tap to start"}
          >
            {!listening ? (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="#fff" className="relative z-10 drop-shadow-md" aria-hidden="true">
                <path d="M12 2C10.34 2 9 3.34 9 5V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V5C15 3.34 13.66 2 12 2Z"/>
                <path d="M19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7C7 13.76 9.24 16 12 16C14.76 16 17 13.76 17 11H19Z"/>
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff" className="relative z-10 drop-shadow-md" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2.5"/>
              </svg>
            )}
          </button>

          {/* Right: Menu button */}
          <button
            className="group relative h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
            style={{ 
              background: 'rgba(255, 255, 255, 0.95)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.4)'
            }}
            aria-label="Menu"
            title="Menu"
            onClick={() => navigate(seeMenuHref)}
          >
            <div 
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{ background: 'linear-gradient(135deg, rgba(250, 40, 81, 0.08), rgba(250, 40, 81, 0.02))' }}
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

      {/* Modals */}
      <SuggestionsModal open={showSuggestions} onClose={() => setShowSuggestions(false)} items={suggestedItems} />
      <TrayModal open={showTray} onClose={() => setShowTray(false)} />
    </div>
  );
}
