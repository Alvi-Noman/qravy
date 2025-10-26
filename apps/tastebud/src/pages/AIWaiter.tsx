// apps/tastebud/src/pages/AIWaiter.tsx
import React, { useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams, Link } from 'react-router-dom';
import { getWsURL } from '../utils/ws';

export default function AIWaiter() {
  const { subdomain, branch, branchSlug } = useParams<{
    subdomain?: string;
    branch?: string;
    branchSlug?: string;
  }>();
  const [search] = useSearchParams();
  const location = useLocation();

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

  const seeMenuHref = resolvedBranch
    ? `/t/${resolvedSub}/${resolvedBranch}/menu`
    : `/t/${resolvedSub}/menu`;

  // --- Audio / WS refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- UI/State ---
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [finals, setFinals] = useState<string[]>([]);

  // --- finalize helpers ---
  const stoppingRef = useRef<boolean>(false);
  const finalSeenRef = useRef<boolean>(false);
  const pendingFinalResolverRef = useRef<null | ((ok: boolean) => void)>(null);

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

  async function startListening() {
    try {
      if (listening || wsRef.current || ctxRef.current) return;

      setStatus('Requesting microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }

      setStatus('Loading…');
      await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;

      const node = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      nodeRef.current = node;

      const ws = new WebSocket(getWsURL('/ws/voice'));
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        stoppingRef.current = false;
        finalSeenRef.current = false;

        ws.send(JSON.stringify({
          t: 'hello',
          sessionId: 'dev-session',
          userId: 'guest',
          rate: 16000,
          ch: 1,
          lang: 'auto', // server auto-detects then locks
        }));
        setStatus('listening');
        setListening(true);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data as string);

          if (msg.t === 'stt_final') {
            finalSeenRef.current = true;
            setFinals((prev) => [...prev, msg.text || '']);
            setStatus('segment captured');
            pendingFinalResolverRef.current?.(true);
          }
        } catch {}
      };

      ws.onerror = () => setStatus('connection error');
      ws.onclose = () => {
        setListening(false);
        if (status !== 'timed out') setStatus('idle');
        pendingFinalResolverRef.current?.(false);
        pendingFinalResolverRef.current = null;
      };

      // frame pump
      let frames = 0;
      node.port.onmessage = (ev) => {
        if (stoppingRef.current) return;
        const ab = ev.data as ArrayBuffer;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(ab);
          frames++;
          // (quiet logging) if needed: if (frames % 50 === 0) console.log('frames:', frames);
        }
      };

      // keep node alive
      src.connect(node);
    } catch (err) {
      console.error(err);
      setStatus('mic error');
      stopListening();
    }
  }

  async function stopListening() {
    setStatus('stopping…');

    // 1) stop sending
    stoppingRef.current = true;

    // 2) ask server to finalize
    let gotFinal = finalSeenRef.current;
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'end' }));

        if (!gotFinal) {
          const ok = await waitForFinal(8000);
          gotFinal = ok;
          if (!ok) setStatus('timed out');
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (e) {
      console.error(e);
    }

    // 3) tear down audio
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    try { nodeRef.current?.port.close(); } catch {}
    try { nodeRef.current?.disconnect(); } catch {}
    nodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { await ctxRef.current?.close(); } catch {}
    ctxRef.current = null;

    // 4) close socket
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    setListening(false);
    setStatus(gotFinal ? 'idle' : 'idle');
  }

  // --- Small helpers for UI ---
  const StatusDot = ({ active }: { active: boolean }) => (
    <span
      className={[
        'inline-block h-2.5 w-2.5 rounded-full',
        active ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300',
      ].join(' ')}
      aria-hidden="true"
    />
  );

  return (
    <div className="min-h-screen bg-[#F6F5F8] font-[Inter]">
      {/* TEMP TEST PANEL (you said you'll remove later) */}
      <div className="fixed right-4 top-4 z-50 w-64 rounded-xl border bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">Finalized</span>
          <StatusDot active={listening} />
        </div>
        <div className="max-h-40 space-y-1 overflow-y-auto text-sm text-gray-900">
          {finals.length ? (
            finals.map((t, i) => (
              <div key={i} className="leading-snug">• {t}</div>
            ))
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto flex max-w-md flex-col items-center px-5 pb-28 pt-10 sm:max-w-lg">
        {/* Header */}
        <div className="mb-6 w-full">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">Voice chat</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <StatusDot active={listening} />
              <span>{status}</span>
            </div>
          </div>
        </div>

        {/* Orb */}
        <div className="relative mb-6 mt-2 flex h-44 w-44 items-center justify-center">
          <div
            className={[
              'h-44 w-44 rounded-full blur-[1px]',
              'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))]',
              listening
                ? 'from-indigo-400 via-purple-400 to-blue-400 animate-[pulse_2.2s_ease-in-out_infinite]'
                : 'from-indigo-200 via-purple-200 to-blue-200',
            ].join(' ')}
          />
          {/* soft gloss */}
          <div className="pointer-events-none absolute -right-3 -top-3 h-20 w-12 rotate-12 rounded-full bg-white/50 blur-md" />
        </div>

        {/* Prompt text */}
        <p className="mx-auto mb-8 max-w-sm text-center text-[15px] leading-6 text-gray-700">
          “Hello 👋 I can help you answer questions, explain topics, write content, or just chat
          casually. Ask me anything!”
        </p>

        {/* Action buttons (minimal) */}
        <div className="mt-2 flex items-center gap-3">
          <Link
            to={seeMenuHref}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            See Menu
          </Link>
          <Link
            to={resolvedBranch ? `/t/${resolvedSub}/${resolvedBranch}/dine-in` : `/t/${resolvedSub}/dine-in`}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
          >
            Dine-in
          </Link>
        </div>

        {/* Mic button fixed to bottom for thumb reachability */}
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          {!listening ? (
            <button
              onClick={startListening}
              className="pointer-events-auto h-16 w-16 rounded-full bg-black text-white shadow-lg ring-8 ring-black/5 active:scale-95"
              aria-pressed="false"
              aria-label="Start voice"
            >
              <span className="sr-only">Start</span>
              🎙️
            </button>
          ) : (
            <button
              onClick={stopListening}
              className="pointer-events-auto h-16 w-16 rounded-full bg-red-600 text-white shadow-lg ring-8 ring-red-600/10 active:scale-95"
              aria-pressed="true"
              aria-label="Stop voice"
            >
              <span className="sr-only">Stop</span>
              ⏹
            </button>
          )}
        </div>

        {/* Path (tiny dev aid) */}
        <p className="mt-10 text-center text-[11px] text-gray-400">Path: {location.pathname}</p>
      </div>
    </div>
  );
}
