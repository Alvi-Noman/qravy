// apps/tastebud/src/components/ai-waiter/MicInputBar.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getWsURL, getStableSessionId } from "../../utils/ws";
import { useConversationStore } from "../../state/conversation";
import { useTTS } from "../../state/TTSProvider";
import { getTTS } from "../../state/tts";

type Lang = "bn" | "en" | "auto";

type Props = {
  className?: string;
  tenant?: string | null;
  branch?: string | null;
  channel?: string | null; // "dine-in" | "online"
  lang?: Lang;            // optional; will be overridden by global broadcast if present
  wsPath?: string;        // default: "/ws/voice"
  onAiReply?: (payload: { replyText: string; meta?: any }) => void;
  onPartial?: (text: string) => void;
  disabled?: boolean;
};

declare global {
  interface Window {
    __WAITER_LANG__?: "bn" | "en" | "auto";
    __QRAVY_LAST_SPOKEN__?: string;
    __QRAVY_LAST_SPOKEN_AT__?: number;
  }
}

export default function MicInputBar({
  className = "",
  tenant,
  branch,
  channel,
  lang = "bn",
  wsPath = "/ws/voice",
  onAiReply,
  onPartial,
  disabled = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const willOwnLiveRef = useRef<boolean>(true);

  const [isRecording, setIsRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [partial, setPartial] = useState("");

  // Store bits
  const setAi           = useConversationStore((s) => s.setAi);
  const aiLive          = useConversationStore((s) => s.aiTextLive);
  const startTtsReveal  = useConversationStore((s) => s.startTtsReveal);
  const appendTtsReveal = useConversationStore((s) => s.appendTtsReveal);
  const finishTtsReveal = useConversationStore((s) => s.finishTtsReveal);

  const tts = useTTS();

  // Inside modal? then don't own the live subscription
  useEffect(() => {
  const el = rootRef.current;
  const inDialog = !!el?.closest('[role="dialog"]');
  if (inDialog) return; // don't subscribe inside modals

  const unsub = tts.subscribe({ /* ...same handlers... */ });
  return unsub;
}, [tts]);

  /* ---------- Word-by-word reveal (no pre-flash) ---------- */
  const WARMUP_MS = 120;
  const MIN_STEP_MS = 80;
  const FALLBACK_STEP_MS = 120;
  const START_PACK_COUNT = 3;

  const anchorSetRef   = useRef(false);
  const baseStartRef   = useRef(0);
  const lastDueRef     = useRef(0);
  const packedCountRef = useRef(0);

  const speakGenRef  = useRef(0);
  const activeGenRef = useRef(0);
  const inSpeechRef  = useRef(false);

  function scheduleAt(due: number, token: string) {
    const w = String(token ?? "").replace(/\s+/g, " ").trim();
    if (!w) return;
    const safeDue = Math.max(due, lastDueRef.current + MIN_STEP_MS, performance.now() + 1);
    lastDueRef.current = safeDue;
    const delay = Math.max(0, safeDue - performance.now());
    setTimeout(() => {
      if (activeGenRef.current !== speakGenRef.current) return;
      try { appendTtsReveal(w); } catch {}
    }, delay);
  }

  useEffect(() => {
    if (!willOwnLiveRef.current) return;

    const unsub = tts.subscribe({
      onStart: () => {
        setThinking(false);

        speakGenRef.current += 1;
        activeGenRef.current  = speakGenRef.current;
        inSpeechRef.current   = true;

        anchorSetRef.current = false;
        baseStartRef.current = 0;
        lastDueRef.current   = 0;
        packedCountRef.current = 0;

        try { startTtsReveal(""); } catch {}
        try { setAi(""); } catch {}
      },

      // @ts-ignore
      onWord: (w: string, offsetMs?: number) => {
        if (activeGenRef.current !== speakGenRef.current) return;

        if (!anchorSetRef.current) {
          anchorSetRef.current = true;
          baseStartRef.current = performance.now() + WARMUP_MS;
          scheduleAt(baseStartRef.current, w);
          packedCountRef.current = 1;
          return;
        }

        if (packedCountRef.current > 0 && packedCountRef.current < START_PACK_COUNT) {
          scheduleAt(lastDueRef.current + MIN_STEP_MS, w);
          packedCountRef.current += 1;
          return;
        }

        if (typeof offsetMs === "number" && isFinite(offsetMs) && offsetMs >= 0) {
          scheduleAt(baseStartRef.current + offsetMs, w);
        } else {
          scheduleAt(Math.max(performance.now(), lastDueRef.current + FALLBACK_STEP_MS), w);
        }
      },

      onEnd: () => {
        if (!inSpeechRef.current) return;
        const myGen = speakGenRef.current;
        const waitMs = Math.max(0, lastDueRef.current - performance.now() + 50);
        setTimeout(() => {
          if (activeGenRef.current !== myGen) return;
          try { finishTtsReveal(); } catch {}
          inSpeechRef.current = false;
          speakGenRef.current += 1;
        }, waitMs);
      },
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts]);

  // keep the last-two-lines scrolled to bottom
  const lastLinesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lastLinesRef.current) return;
    lastLinesRef.current.scrollTop = lastLinesRef.current.scrollHeight;
  }, [aiLive]);

  // Tap/Hold state (single declarations)
  const HOLD_MS = 250;
  const holdTimerRef = useRef<number | null>(null);
  const isHoldModeRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const lastDownAtRef = useRef(0);

  // language: 🔒 force Bangla for this bar
  const getGlobalLang = (): Lang => "bn";

  const [currentLang, setCurrentLang] = useState<Lang>(getGlobalLang());
  useEffect(() => {
    // Always stay in Bangla; ignore global toggles
    setCurrentLang("bn");
    if (typeof window === "undefined") return;
    const handler = (_e: Event) => {
      setCurrentLang("bn");
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: "set_lang", lang: "bn" }));
      }
    };
    window.addEventListener("qravy:lang", handler as EventListener);
    return () => window.removeEventListener("qravy:lang", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Prop `lang` is ignored; always Bangla
    setCurrentLang("bn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // WS & audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const wsGenRef = useRef(0); // track WS generation to ignore stale handlers
  const acRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const pingTimerRef = useRef<number | null>(null); // 👈 keepalive interval id

  // Stop only audio (keep WS for reply)
  const stopCaptureOnly = useCallback(async () => {
    try {
      if (nodeRef.current) {
        try { (nodeRef.current.port as any).onmessage = null; } catch {}
        try { nodeRef.current.disconnect(); } catch {}
      }
      if (srcRef.current) {
        try { srcRef.current.disconnect(); } catch {}
      }
      if (mediaRef.current) {
        try { mediaRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      }
      if (acRef.current) {
        try { await acRef.current.close(); } catch {}
      }
    } catch {}
    nodeRef.current = null;
    srcRef.current = null;
    acRef.current = null;
    mediaRef.current = null;
    setPartial("");
  }, []);

  // Hard reset: audio + WS + state (used on unmount / WS error)
  const hardReset = useCallback(async () => {
    try {
      await stopCaptureOnly();
      if (wsRef.current) {
        try {
          wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onerror = wsRef.current.onclose = null;
          if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
            wsRef.current.close();
          }
        } catch {}
      }
    } catch {}
    if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    wsRef.current = null;
    try { getTTS().unduck(); } catch {}
    setIsRecording(false);
    setThinking(false);
    setPartial("");
  }, [stopCaptureOnly]);

  // speak dedupe
  function shouldSpeakOnce(text: string): boolean {
    if (typeof window === "undefined") return true;
    const key = text.trim();
    const now = performance.now();
    const lastKey = window.__QRAVY_LASTSPOKEN__;
    const lastAt  = window.__QRAVY_LASTSPOKEN_AT__ ?? 0;
    if (lastKey === key && now - lastAt < 8000) return false;
    window.__QRAVY_LASTSPOKEN__ = key;
    window.__QRAVY_LASTSPOKEN_AT__ = now;
    return true;
  }

  // WebSocket: always fresh per recording session
  const openWebSocket = useCallback(() => {
    // close any existing socket before starting a new one
    if (wsRef.current) {
      try {
        wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onerror = wsRef.current.onclose = null;
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close();
        }
      } catch {}
      wsRef.current = null;
    }

    const sid = getStableSessionId();
    const url = getWsURL(wsPath);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const myGen = ++wsGenRef.current;
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsGenRef.current !== myGen) return;

      const tz =
        typeof Intl !== "undefined" &&
        Intl.DateTimeFormat().resolvedOptions().timeZone
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;

      const localHour =
        typeof window !== "undefined"
          ? new Date().getHours()
          : undefined;

      // 👇 IMPORTANT: send `hello` immediately on open, always Bangla
      const langToSend: Lang = "bn";

      const startMsg: any = {
        t: "hello",                 // 👈 changed from "start" to "hello"
        sessionId: sid,
        userId: "guest",
        rate: 16000,
        ch: 1,
        lang: langToSend,           // <-- always "bn"
        tenant: tenant ?? undefined,
        branch: branch ?? undefined,
        channel: channel ?? undefined,
        tz,
        localHour,
      };
      try { ws.send(JSON.stringify(startMsg)); } catch {}

      // optional keepalive to avoid idle closures across proxies
      if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); }
      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ t: "ping" })); } catch {}
        }
      }, 15000);
    };

    ws.onmessage = (ev) => {
      if (wsGenRef.current !== myGen) return;

      try {
        const data = JSON.parse(ev.data);

        if (data.t === "stt_partial") {
          if (data.text && onPartial) {
            onPartial(data.text);
            setPartial(data.text);
          }
          return;
        }

        if (data.t === "ai_reply_pending") {
          setThinking(true);
          setAi("Thinking…");
          return;
        }

        if (data.t === "ai_reply") {
          const meta = data.meta || {};
          const replyText = (data.replyText || "").toString().trim();
          const voiceText = (meta.voiceReplyText || "").toString().trim();
          const speakText = voiceText || replyText;

          if (speakText && shouldSpeakOnce(speakText)) {
            try { tts.speak(speakText); } catch {}
          }

          setThinking(false);

          console.log("[AI RAW][MicInputBar]", { replyText, voiceText, meta });

          onAiReply?.({ replyText, meta });

          // close this session socket after reply
          try {
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close();
            }
          } catch {}
          if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
          if (wsRef.current === ws) wsRef.current = null;
          return;
        }

        if (data.t === "ai_reply_error") {
          setThinking(false);
          // close on error
          try {
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close();
            }
          } catch {}
          if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
          if (wsRef.current === ws) wsRef.current = null;
          return;
        }
      } catch {
        // ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      if (wsGenRef.current !== myGen) return;
      if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
      hardReset();
    };

    ws.onclose = () => {
      if (wsGenRef.current !== myGen) return;
      if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }

      const ac = acRef.current;

      // WS closed before / as AudioContext was created → don't nuke everything
      if (!ac || ac.state === "closed") {
        if (wsRef.current === ws) wsRef.current = null;
        return;
      }

      // if we are mid session (recording/thinking) and it closes unexpectedly, hard reset
      if (isRecording || thinking) {
        hardReset();
        return;
      }

      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [
    branch,
    channel,
    currentLang,
    hardReset,
    isRecording,
    thinking,
    onAiReply,
    onPartial,
    tenant,
    tts,
    setAi,
    wsPath,
  ]);

  // Start capture
  const start = useCallback(async () => {
    if (disabled || isRecording) return;
    setIsRecording(true);

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    try { setAi(""); } catch {}
    setThinking(false);
    setPartial("");

    try { getTTS().duck(); } catch {}

    openWebSocket();

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac = new AC({ sampleRate: 48000 });
    acRef.current = ac;

    await ac.audioWorklet.addModule("/worklets/audio-capture.worklet.js");

    // ensure audio context is running so worklet can process
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch {}
    }

    const media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    mediaRef.current = media;

    const src = ac.createMediaStreamSource(media);
    srcRef.current = src;

    const node = new AudioWorkletNode(ac, "capture-processor", { numberOfInputs: 1, numberOfOutputs: 0 });
    nodeRef.current = node;

    node.port.postMessage({ type: "configure", frameMs: 20 });

    node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if ((msg as any).type === "chunk" && (msg as any).samples instanceof Int16Array) {
        ws.send((msg as any).samples.buffer);
      } else if (msg instanceof ArrayBuffer) {
        ws.send(msg);
      }
    };

    src.connect(node);
  }, [disabled, isRecording, openWebSocket, finishTtsReveal, startTtsReveal, setAi]);

  // Stop capture → show Thinking immediately, keep WS to receive reply
  const stop = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    setThinking(true);
    setAi("Thinking…");

    // tell server no more audio, but keep WS open for ai_reply
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: "end" }));
      }
    } catch {}

    await stopCaptureOnly();
    try { getTTS().unduck(); } catch {}
  }, [isRecording, setAi, startTtsReveal, finishTtsReveal, stopCaptureOnly]);

  // Unmount → full reset
  useEffect(() => {
    return () => {
      hardReset();
    };
  }, [hardReset]);

  // Pointer handlers
  const onPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    pointerActiveRef.current = true;
    isHoldModeRef.current = false;
    lastDownAtRef.current = Date.now();

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    try { setAi(""); } catch {}

    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdTimerRef.current = window.setTimeout(async () => {
      if (!pointerActiveRef.current) return;
      isHoldModeRef.current = true;
      if (!isRecording) await start();
    }, HOLD_MS);
  }, [disabled, isRecording, start, startTtsReveal, finishTtsReveal, setAi]);

  const endPressCycle = useCallback(async () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const wasHold = isHoldModeRef.current;
    isHoldModeRef.current = false;
    pointerActiveRef.current = false;

    if (wasHold) {
      await stop();
      return;
    }

    const pressedFor = Date.now() - lastDownAtRef.current;
    if (pressedFor < HOLD_MS) {
      if (isRecording) {
        await stop();
      } else {
        await start();
      }
    }
  }, [start, stop, isRecording]);

  const onPointerUp = useCallback(async (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    await endPressCycle();
  }, [disabled, endPressCycle]);

  const onPointerLeave = useCallback(async (e: React.PointerEvent) => {
    if (disabled) return;
    if (pointerActiveRef.current) {
      e.preventDefault();
      await endPressCycle();
    }
  }, [disabled, endPressCycle]);

  // Display logic
  const subtitle = thinking ? "Thinking…" : (aiLive || "");
  const hasContent = (subtitle?.length ?? 0) > 0;

  // Linger the panel for 1s after finish, and freeze last text
  const [showExpanded, setShowExpanded] = useState(false);
  const lastSubtitleRef = useRef("");
  useEffect(() => {
    if (hasContent) lastSubtitleRef.current = subtitle;
  }, [subtitle, hasContent]);
  const displayText = hasContent ? subtitle : (showExpanded ? lastSubtitleRef.current : "");

  useEffect(() => {
    if (hasContent) {
      setShowExpanded(true);
    } else {
      const t = setTimeout(() => setShowExpanded(false), 1000);
      return () => clearTimeout(t);
    }
  }, [hasContent]);

  return (
    <div ref={rootRef} className={["relative w-full", className].join(" ")}>
      {/* Soft floor gradient */}
      <div
        className="fixed left-0 right-0 bottom-0 h-40 bg-gradient-to-t from-[#F6F5F8]/100 from-[60%] to-[#F6F5F8]/0 to-[100%]"
        aria-hidden="true"
      />

      <div className="relative">
        {/* EXPANDABLE AI RESPONSE PANEL (slides above the bar) */}
        <div
          className={[
            "absolute bottom-full left-0 right-0 mb-3 transition-all duration-500 ease-out",
            showExpanded ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-4 scale-95 pointer-events-none",
          ].join(" ")}
        >
          <div className="relative">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-white to-indigo-50/50 border border-violet-200/60 shadow-xl shadow-violet-500/10 backdrop-blur-sm">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 via-indigo-500 to-violet-500" />
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* AI Avatar */}
                  <div className="shrink-0">
                    <div
                      className={[
                        "w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md transition-transform duration-300",
                        thinking ? "scale-95" : "scale-100",
                      ].join(" ")}
                    >
                      {thinking ? (
                        <div className="flex gap-0.5">
                          <div className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      ) : (
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-violet-700 tracking-wide">AI ASSISTANT</span>
                      {!thinking && aiLive && (
                        <div className="flex gap-0.5">
                          {[...Array(3)].map((_, i) => (
                            <div
                              key={i}
                              className="w-0.5 h-3 bg-gradient-to-t from-violet-400 to-indigo-400 rounded-full"
                              style={{ animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${i * 150}ms`, opacity: 0.6 }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-gray-700 font-medium">
                      {displayText || <span className="text-gray-400 italic">Processing...</span>}
                    </p>
                  </div>

                  {/* Dismiss (visual only; no behavior change) */}
                  <button
                    onClick={() => { /* visual close only */ }}
                    className="shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                    aria-label="Dismiss"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {aiLive && !thinking && (
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  style={{ animation: "shimmer 3s ease-in-out infinite", backgroundSize: "200% 100%" }}
                />
              )}
            </div>

            <div className="absolute -bottom-2 left-8 w-4 h-4 bg-gradient-to-br from-violet-50 to-white border-r border-b border-violet-200/60 transform rotate-45" />
          </div>
        </div>

        {/* MAIN CONTROL BAR */}
        <div
          className={[
            "relative overflow-hidden rounded-full transition-all duration-300",
            isRecording
              ? "bg-gradient-to-r from-rose-500 to-pink-600 shadow-lg shadow-rose-500/30 border border-rose-400/50"
              : "bg-white shadow-md hover:shadow-lg border border-gray-100",
          ].join(" ")}
        >
          {isRecording && (
            <>
              <div className="absolute inset-0 rounded-full animate-[ping_1.5s_ease-in-out_infinite] bg-rose-400/30" />
              <div className="absolute inset-0 rounded-full animate-[ping_2s_ease-in-out_infinite] bg-rose-400/20" style={{ animationDelay: "0.5s" }} />
            </>
          )}

          <div className="relative flex items-center gap-2 pl-4 pr-2 py-2">
            <div className="flex-1 flex items-center gap-3 min-h-[44px]">
              <div className="shrink-0">
                <div
                  className={[
                    "w-2 h-2 rounded-full transition-all duration-300",
                    isRecording ? "bg-white shadow-lg shadow-white/50 animate-pulse"
                    : hasContent ? "bg-violet-500 animate-pulse"
                    : "bg-gray-300",
                  ].join(" ")}
                />
              </div>

              <div className="flex-1 flex items-center min-w-0">
                {isRecording ? (
                  <div className="flex items-center gap-0.5 h-5">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-0.5 rounded-full bg-white/90"
                        style={{
                          height: `${8 + Math.sin(Date.now() / 200 + i * 0.5) * 8}px`,
                          animation: "wave 0.6s ease-in-out infinite alternate",
                          animationDelay: `${i * 0.05}s`,
                        }}
                      />
                    ))}
                  </div>
                ) : hasContent ? (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-violet-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z"/>
                        <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z"/>
                      </svg>
                      <span className="font-medium text-violet-600">AI Assistant</span>
                    </div>
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-1 h-1 rounded-full bg-violet-400 animate-bounce"
                          style={{ animationDelay: `${i * 150}ms`, animationDuration: "1s" }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-gray-500 font-medium truncate">
                    Hold or tap to talk
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={disabled}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
              className={[
                "relative h-12 w-12 shrink-0 rounded-full transition-all duration-200 flex items-center justify-center",
                isRecording
                  ? "bg-white text-[#FA2851] scale-110 shadow-xl"
                  : "bg-gradient-to-br from-[#FF8EA3] via-[#FA2851] to-[#D91440] text-white hover:scale-105 active:scale-95 shadow-lg",
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
              style={{ touchAction: "manipulation" }}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              title="Tap to toggle • Hold to talk"
            >
              <svg
                className="w-5 h-5 relative z-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 106 0V5a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0M12 18v4" />
              </svg>

              {isRecording && <span className="absolute inset-0 rounded-full animate-ping bg-rose-400/40" />}
            </button>
          </div>
        </div>

        <div className="sr-only">
          <div ref={lastLinesRef} className="h-[2.8em] leading-snug overflow-y-auto pr-1">
            <div className="whitespace-pre-wrap break-words">{subtitle}</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes wave {
          to { height: ${12 + Math.random() * 12}px; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}
