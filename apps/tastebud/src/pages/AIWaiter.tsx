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

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [partial, setPartial] = useState<string>('');
  const [finals, setFinals] = useState<string[]>([]);

  const stoppingRef = useRef<boolean>(false);
  const finalSeenRef = useRef<boolean>(false);
  const waitingForFinalRef = useRef<boolean>(false);

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

      setStatus('Loading worklet…');
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
        console.log('[WS] open');
        stoppingRef.current = false;
        finalSeenRef.current = false;

        ws.send(JSON.stringify({
          t: 'hello',
          sessionId: 'dev-session',
          userId: 'guest',
          rate: 16000,
          ch: 1,
        }));
        setStatus('Connected — streaming…');
        setListening(true);
      };

      ws.onmessage = (ev) => {
        console.log('[WS] received message, type:', typeof ev.data, 'length:', ev.data?.length);
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data);
          console.log('[WS] parsed message:', msg.t);
          if (msg.t === 'ack') {
            console.log('[WS] received ack');
            return;
          }
          if (msg.t === 'stt_partial') {
            if (finalSeenRef.current) {
              console.log('[WS] ignoring partial (final already seen)');
              return;
            }
            setPartial(msg.text || '');
            console.log('[WS] stt_partial:', msg.text);
            return;
          }
          if (msg.t === 'stt_final') {
            console.log('[WS] 🎉 GOT STT_FINAL:', msg.text);
            finalSeenRef.current = true;
            setPartial('');
            setFinals((prev) => [...prev, msg.text || '']);
            setStatus('Finalized one segment.');
            pendingFinalResolverRef.current?.(true);
            return;
          }
          if (msg.t === 'error') {
            console.error('[WS] error payload:', msg.message);
          }
        } catch (e) {
          console.error('[WS] failed to parse message:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] error', err);
        setStatus('WebSocket error (see console)');
      };

      ws.onclose = () => {
        console.log('[WS] close');
        setListening(false);
        setStatus('Connection closed');
      };

      let frames = 0;
      node.port.onmessage = (ev) => {
        if (stoppingRef.current) return;
        const ab = ev.data as ArrayBuffer;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(ab);
          frames++;
          if (frames % 50 === 0) console.log('worklet frames sent:', frames);
        }
      };

      // Keep node alive (no audible output; no connection to destination)
      src.connect(node);

      setStatus('Listening…');
    } catch (err) {
      console.error(err);
      setStatus('Mic or worklet error. Check permissions & console.');
      stopListening();
    }
  }

  async function stopListening() {
    console.log('[CLIENT] ========== STOP LISTENING STARTED ==========');
    setStatus('Stopping…');

    // 1) Stop sending new frames immediately
    stoppingRef.current = true;
    console.log('[CLIENT] stopped sending frames');

    // 2) Ask server to finalize while WS is still open
    let gotFinal = finalSeenRef.current;
    console.log('[CLIENT] finalSeenRef.current:', gotFinal);
    console.log('[CLIENT] wsRef.current state:', wsRef.current?.readyState);
    
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[CLIENT] ✅ WS is OPEN, sending end signal...');
        wsRef.current.send(JSON.stringify({ t: 'end' }));
        console.log('[CLIENT] end signal sent successfully');
        
        if (!gotFinal) {
          console.log('[CLIENT] waiting for stt_final (8s timeout)...');
          const startWait = Date.now();
          gotFinal = await waitForFinal(8000);
          const elapsed = Date.now() - startWait;
          console.log(`[CLIENT] wait finished after ${elapsed}ms, gotFinal:`, gotFinal);
          
          if (!gotFinal) {
            console.warn('[CLIENT] ⚠️ TIMED OUT waiting for stt_final');
            setStatus('Timed out waiting for final transcription');
          } else {
            console.log('[CLIENT] ✅ received stt_final successfully');
          }
        } else {
          console.log('[CLIENT] final already received, skipping wait');
        }
        
        // Small grace period for any in-flight messages
        console.log('[CLIENT] waiting 100ms grace period...');
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('[CLIENT] grace period done');
      } else {
        console.warn('[CLIENT] ⚠️ WS not open, state:', wsRef.current?.readyState);
      }
    } catch (e) {
      console.error('[CLIENT] ❌ error during stop:', e);
    }

    // 3) Tear down audio graph
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    try { nodeRef.current?.port.close(); } catch {}
    try { nodeRef.current?.disconnect(); } catch {}
    nodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    try { await ctxRef.current?.close(); } catch {}
    ctxRef.current = null;

    // 4) Close WS
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    setListening(false);
    if (gotFinal) {
      setStatus('Stopped - transcription complete');
    } else {
      setStatus('Stopped - transcription may be incomplete');
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F5F8] font-[Inter] flex items-center">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-[30px] sm:text-[36px] font-semibold text-gray-900 mb-2">
          Meet your AI Waiter
        </h1>
        <p className="text-gray-600 mb-8">
          Ask for recommendations, dietary options, combos, or specials. Speak or type—your call.
        </p>

        <div className="rounded-2xl bg-white border p-6 shadow-sm mb-8">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">{status}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border p-3">
                <div className="text-xs uppercase text-gray-500 mb-1">Live partial</div>
                <div className="min-h-[64px] whitespace-pre-wrap text-gray-900">
                  {partial || <span className="text-gray-400">—</span>}
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-xs uppercase text-gray-500 mb-1">Finalized</div>
                <div className="min-h-[64px] whitespace-pre-wrap text-gray-900">
                  {finals.length ? (
                    finals.map((t, i) => (
                      <div key={i} className="mb-1">
                        • {t}
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
              </div>
            </div>

            {!listening ? (
              <button
                onClick={startListening}
                className="self-center px-5 py-2 rounded-xl bg-black text-white hover:opacity-90"
              >
                🎙️ Start Talking
              </button>
            ) : (
              <button
                onClick={stopListening}
                className="self-center px-5 py-2 rounded-xl bg-red-600 text-white hover:opacity-90"
              >
                ⏹ Stop
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            to={seeMenuHref}
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium bg-black text-white hover:opacity-90"
          >
            See Menu
          </Link>
          <Link
            to={
              resolvedBranch
                ? `/t/${resolvedSub}/${resolvedBranch}/dine-in`
                : `/t/${resolvedSub}/dine-in`
            }
            className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium bg-white text-gray-900 hover:bg-gray-50"
          >
            Dine-in View
          </Link>
        </div>

        <p className="mt-6 text-xs text-gray-400">Path: {location.pathname}</p>
      </div>
    </div>
  );
}