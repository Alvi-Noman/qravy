// apps/tastebud/src/pages/AiWaiterHome.tsx
import React, { useRef, useState, useEffect } from 'react';
import { useLocation, useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { getWsURL } from '../utils/ws';
import MicHalo from '../components/ai-waiter/MicHalo';
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/TrayModal';
import type { WaiterIntent, AiReplyMeta } from '../types/waiter-intents';

// 🧩 NEW imports
import { buildMenuIndex, resolveItemIdByName } from '../utils/item-resolver';
import { useCart } from '../context/CartContext';
import { routeFromAiReply } from '../utils/intent-routing';
import { usePublicMenu } from '../hooks/usePublicMenu'; // ✅ added

type UIMode = 'idle' | 'thinking' | 'talking';

export default function AiWaiterHome() {
  const navigate = useNavigate();
  const { subdomain, branch, branchSlug } = useParams<{ subdomain?: string; branch?: string; branchSlug?: string }>();
  const [search] = useSearchParams();
  const location = useLocation();

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

  // analyser for level metering
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafLevelRef = useRef<number | null>(null);

  const [listening, setListening] = useState(false);
  const [finals, setFinals] = useState<string[]>([]);
  const [aiReplies, setAiReplies] = useState<string[]>([]);
  const [level, setLevel] = useState(0);

  const [uiMode, setUiMode] = useState<UIMode>('idle');

  // Language toggle
  const [selectedLang, setSelectedLang] = useState<'auto' | 'bn' | 'en'>('bn');

  const stoppingRef = useRef<boolean>(false);

  // --- latches for waiting on events ---
  const finalSeenRef = useRef<boolean>(false);
  const pendingFinalResolverRef = useRef<null | ((ok: boolean) => void)>(null);

  const aiSeenRef = useRef<boolean>(false);
  const pendingAiResolverRef = useRef<null | ((ok: boolean) => void)>(null);

  // ===== Intent-driven UI contexts =====
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTray, setShowTray] = useState(false);

  // Helpers to open/close contexts
  const openSuggestions = () => { setShowTray(false); setShowSuggestions(true); };
  const openTray = () => { setShowSuggestions(false); setShowTray(true); };
  const goMenu = () => { setShowSuggestions(false); setShowTray(false); navigate(seeMenuHref); };

  // 🧩 NEW: menu + cart
  const { addItem } = useCart();
  const { items: storeItems } = usePublicMenu(resolvedSub, resolvedBranch, 'dine-in'); // ✅ replace manual fetch
  const [menuIndex, setMenuIndex] = useState<ReturnType<typeof buildMenuIndex> | null>(null);

  useEffect(() => {
    if (storeItems?.length) setMenuIndex(buildMenuIndex(storeItems));
  }, [storeItems]);

  // ✅ NEW: carry items to SuggestionsModal
  type SuggestedItem = { id?: string; name?: string; price?: number; imageUrl?: string };
  const [suggestedItems, setSuggestedItems] = useState<SuggestedItem[]>([]);

  function handleIntentRouting(intent: WaiterIntent | undefined) {
    if (!intent) return;

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

  // ---------- Smart suggestion mappers (LLM-driven, no keywords) ----------
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

  // Use LLM meta first; if IDs missing, resolve by name via menuIndex.
  function buildSuggestionsFromMeta(meta: AiReplyMeta | undefined): SuggestedItem[] {
    if (!menuIndex) return [];
    const out: SuggestedItem[] = [];

    // 1) Direct items list
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

    // 2) Optional groups: meta.suggestions = [{title?, items:[{...}]}]
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

    // Deduplicate by id/name combo
    const seen = new Set<string>();
    return out.filter((x) => {
      const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // If LLM doesn't structure items, harvest names directly from reply text.
  function buildSuggestionsFromReplyText(replyText: string): SuggestedItem[] {
    if (!replyText || !storeItems?.length) return [];
    const lc = replyText.toLowerCase();

    const hits: SuggestedItem[] = [];
    for (const s of storeItems as any[]) {
      const name = (s?.name ?? '').toString();
      if (!name) continue;

      // Match canonical name
      const nameHit = lc.includes(name.toLowerCase());

      // Also check aliases if present
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

    // Deduplicate
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

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }

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
        stoppingRef.current = false;
        finalSeenRef.current = false;
        aiSeenRef.current = false;
        ws.send(JSON.stringify({
          t: 'hello',
          sessionId: 'dev-session',
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

          if (msg.t === 'stt_final') {
            finalSeenRef.current = true;
            setFinals((p) => [...p, msg.text || '']);
            pendingFinalResolverRef.current?.(true);
            return;
          }

          if (msg.t === 'ai_reply_pending') {
            setUiMode('thinking');
            return;
          }

          if (msg.t === 'ai_reply') {
            const text = (msg.replyText as string) || '';
            if (text) setAiReplies((prev) => [...prev, text]);
            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(true);
            setUiMode('talking');

            // 🧩 Enhanced intent logic
            const meta: AiReplyMeta | undefined = msg.meta;
            const intent = (meta?.intent ?? 'chitchat') as WaiterIntent;

            // ✅ LLM-driven suggestions (no keyword gating)
            if (intent === 'suggestions') {
              let mapped: SuggestedItem[] = [];
              // Prefer well-structured meta (items / suggestions groups)
              const metaBased = buildSuggestionsFromMeta(meta);
              mapped = metaBased;

              // If meta gave nothing, harvest from free text using live menu
              if ((!mapped || mapped.length === 0) && text) {
                mapped = buildSuggestionsFromReplyText(text);
              }

              // If still empty but we have some store items, offer top few as graceful fallback
              if ((!mapped || mapped.length === 0) && Array.isArray(storeItems) && storeItems.length) {
                mapped = (storeItems as any[]).slice(0, Math.min(8, storeItems.length)).map((s) => ({
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
                  // try to pick up a price from our local storeItems, then from the AI-provided meta, otherwise fallback to 0
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
            setAiReplies((prev) => [...prev, '[AI is temporarily unavailable]']);
            aiSeenRef.current = true;
            pendingAiResolverRef.current?.(false);
            setUiMode('idle');
            return;
          }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        setListening(false);
        pendingFinalResolverRef.current?.(false);
        pendingFinalResolverRef.current = null;
        pendingAiResolverRef.current?.(false);
        pendingAiResolverRef.current = null;
      };

      node.port.onmessage = (ev) => {
        if (stoppingRef.current) return;
        const ab = ev.data as ArrayBuffer;
        if (ws.readyState === WebSocket.OPEN) ws.send(ab);
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
        wsRef.current.send(JSON.stringify({ t: 'end' }));
        if (!gotFinal) gotFinal = await waitForFinal(8000);
        if (!aiSeenRef.current) await waitForAiReply(8000);
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (e) { console.error(e); }

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

  // ===== visuals =====
  const ACCENT = '#FA2851';
  const bgWhite = '#FFFFFF';
  const bgPink = '#FFF0F3';

  const chipBase = 'px-3 py-1.5 rounded-full text-sm font-medium border transition-all active:scale-95';
  const activeChip = 'bg-[#FA2851] text-white border-[#FA2851] shadow-[0_6px_20px_rgba(250,40,81,0.25)]';
  const inactiveChip = 'bg-white/80 text-gray-700 border-white/70 backdrop-blur hover:bg-white';

  type HaloVisualMode = 'idle' | 'listening' | 'talking';
  const haloVisualMode: HaloVisualMode =
    uiMode === 'talking'
      ? 'talking'
      : listening
      ? 'listening'
      : 'idle';

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
        <button type="button" onClick={() => setUiMode((m) => (m === 'thinking' ? 'idle' : 'thinking'))}
          className={`${chipBase} ${uiMode === 'thinking' ? activeChip : inactiveChip}`}>Thinking</button>
        <button type="button" onClick={() => setUiMode((m) => (m === 'talking' ? 'idle' : 'talking'))}
          className={`${chipBase} ${uiMode === 'talking' ? activeChip : inactiveChip}`}>Talking</button>
      </div>

      {/* Language switcher */}
      <div className="fixed bottom-4 left-4 z-50 flex gap-2">
        {(['auto','bn','en'] as const).map((l) => (
          <button key={l} onClick={() => setSelectedLang(l)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              selectedLang === l ? 'bg-[#FA2851] text-white' : 'bg-white/90 text-gray-700 border border-gray-200'
            }`}>{l.toUpperCase()}</button>
        ))}
      </div>

      {/* Transcript & AI cards */}
      <div className="fixed right-4 top-4 z-50 w-64 rounded-xl border border-white/20 bg-white/60 backdrop-blur-md p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-800">Finalized</span>
          <span className="inline-flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-gray-600">{uiMode}</span>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: listening ? '#10B981' : '#D1D5DB' }} />
          </span>
        </div>
        <div className="max-h-40 overflow-y-auto text-sm text-gray-900 space-y-1">
          {finals.length ? finals.map((t, i) => <div key={i}>• {t}</div>) : <span className="text-gray-500">—</span>}
        </div>
      </div>

      <div className="fixed right-4 top-[190px] z-50 w-64 rounded-xl border border-white/20 bg-white/60 backdrop-blur-md p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-800">AI Reply</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-600">
            {aiReplies.length ? `${aiReplies.length}` : '—'}
          </span>
        </div>
        <div className="max-h-40 overflow-y-auto text-sm text-gray-900 space-y-1">
          {aiReplies.length ? aiReplies.map((t, i) => <div key={i}>• {t}</div>) : <span className="text-gray-500">—</span>}
        </div>
      </div>

      {/* Main hero */}
      <div className="pt-40 sm:pt-48 text-left w-full max-w-[400px]">
        <p className="text-[30px] md:text-[40px] leading-[1.6] font-medium text-[#2D2D2D]">
          আসসালামু আলাইকুম<br />আপনি কি কোন ফুড অর্ডার<br />করতে চাইছেন? নাকি আমি<br />আপনাকে কিছু সাজেস্ট<br />করবো?
        </p>
      </div>

      {/* Mic + Menu */}
      <div className="relative flex flex-col items-center justify-center">
        <MicHalo size={600} color={'#FFE9ED'} opacity={0.6} accentColor={'#FA2851'} mode={haloVisualMode} level={level} />
        {!listening ? (
          <button onClick={startListening}
            className="relative h-[120px] w-[120px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 z-[2]"
            style={{ background: '#FA2851', boxShadow: '0 8px 24px rgba(250,40,81,0.3)' }} aria-label="Start voice">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c1.66 0 3 1.34 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-6.92h-2z"/></svg>
          </button>
        ) : (
          <button onClick={stopListening}
            className="relative h-[120px] w-[120px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 z-[2]"
            style={{ background: '#FA2851', boxShadow: '0 8px 24px rgba(250,40,81,0.3)' }} aria-label="Stop voice">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="#fff"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
          </button>
        )}
        <Link to={seeMenuHref}
          className="mt-6 z-[3] px-6 py-3 rounded-full text-[16px] font-medium bg-white/95 text-[#FA2851] border border-white/80 shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-transform duration-300 hover:scale-[1.03] active:scale-95">
          See Menu
        </Link>
      </div>

      {/* Modals */}
      <SuggestionsModal open={showSuggestions} onClose={() => setShowSuggestions(false)} items={suggestedItems} />
      <TrayModal open={showTray} onClose={() => setShowTray(false)} />
    </div>
  );
}
