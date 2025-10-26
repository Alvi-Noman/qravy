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
  const streamRef = useRef<MediaStream | null>(null);

  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [partial, setPartial] = useState<string>('');
  const [finals, setFinals] = useState<string[]>([]);

  async function startListening() {
    try {
      setStatus('Requesting microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // iOS/Safari commonly runs at 48k; we’ll resample to 16k in the worklet.
      const ctx = new AudioContext();
      ctxRef.current = ctx;

      // iOS needs explicit resume in a click handler
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {}
      }

      setStatus('Loading worklet…');
      await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');

      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'capture-processor');
      nodeRef.current = node;

      const ws = new WebSocket(getWsURL('/ws/voice'));
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] open');
        // Advertise that we are sending 16k mono frames
        ws.send(
          JSON.stringify({
            t: 'hello',
            sessionId: 'dev-session',
            userId: 'guest',
            rate: 16000,
            ch: 1,
          }),
        );
        setStatus('Connected — streaming…');
        setListening(true);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.t === 'ack') {
            console.log('[WS] ack');
            return;
          }
          if (msg.t === 'stt_partial') {
            setPartial(msg.text || '');
            return;
          }
          if (msg.t === 'stt_final') {
            setPartial('');
            setFinals((prev) => [...prev, msg.text || '']);
            setStatus('Finalized one segment.');
            return;
          }
        } catch {
          // non-JSON (ignore)
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

      // Forward 20ms Int16 frames (ArrayBuffer) from worklet to WS
      node.port.onmessage = (ev) => {
        const ab = ev.data as ArrayBuffer;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(ab);
        }
      };

      // Keep audio graph alive (don’t route to speakers to avoid echo)
      src.connect(node);
      // No node.connect(ctx.destination)

      setStatus('Listening…');
    } catch (err) {
      console.error(err);
      setStatus('Mic or worklet error. Check permissions & console.');
      stopListening(); // cleanup partial initialization
    }
  }

  async function stopListening() {
    setStatus('Stopping…');

    // Ask server to finalize
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'end' }));
        // Give server a tiny moment to compute final before closing
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {}

    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;

    try {
      nodeRef.current?.port?.close?.();
    } catch {}
    nodeRef.current?.disconnect();
    nodeRef.current = null;

    try {
      ctxRef.current?.close();
    } catch {}
    ctxRef.current = null;

    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;

    setListening(false);
    setStatus('Stopped');
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
