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
  const willOwnLiveRef = useRef<boolean>(true); // set after mount by DOM check

  // unique ID for this MicInputBar instance (used only for debugging/ownership if needed)
  const ownerIdRef = useRef<string>("");
  if (!ownerIdRef.current) {
    ownerIdRef.current =
      `micbar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  const [isRecording, setIsRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [partial, setPartial] = useState("");
  const [aiText, setAiText] = useState(""); // local buffer (not shown if global live exists)

  // Zustand (pull only what we need)
  const setAi           = useConversationStore((s) => s.setAi);
  const aiLive          = useConversationStore((s) => s.aiTextLive);
  const globalAiText    = useConversationStore((s) => s.aiText);
  const startTtsReveal  = useConversationStore((s) => s.startTtsReveal);
  const appendTtsReveal = useConversationStore((s) => s.appendTtsReveal);
  const finishTtsReveal = useConversationStore((s) => s.finishTtsReveal);

  // TTS
  const tts = useTTS();

  // Determine if this MicInputBar is inside a modal/dialog → then DO NOT subscribe or speak-ownership
  useEffect(() => {
    const el = rootRef.current;
    const inDialog = !!el?.closest('[role="dialog"]');
    willOwnLiveRef.current = !inDialog; // page bars own live; modal bars are viewers only
  }, []);

  // ---------- TTS live reveal (subscribe ONLY if we own live) ----------
  const synthStartAtRef = useRef<number>(0);
  useEffect(() => {
    if (!willOwnLiveRef.current) return; // modal: rely on existing owner (e.g., AiWaiterHome)

    const unsub = tts.subscribe({
      onStart: (text: string) => {
        synthStartAtRef.current = performance.now();
        try { startTtsReveal(text); } catch {}
      },
      // @ts-ignore: (word, offsetMs) signature
      onWord: (w: string, offsetMs?: number) => {
        if (typeof offsetMs === "number" && isFinite(offsetMs)) {
          const due = synthStartAtRef.current + offsetMs;
          const delay = Math.max(0, due - performance.now());
          setTimeout(() => { try { appendTtsReveal(w); } catch {} }, delay);
        } else {
          try { appendTtsReveal(w); } catch {}
        }
      },
      onEnd: () => { try { finishTtsReveal(); } catch {} },
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts]);

  // viewport keep-bottom
  const lastLinesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lastLinesRef.current) return;
    lastLinesRef.current.scrollTop = lastLinesRef.current.scrollHeight;
  }, [aiLive, globalAiText, aiText]);

  // =================== Tap / Hold press logic (single declarations) ===================
  const HOLD_MS = 250;
  const holdTimerRef = useRef<number | null>(null);
  const isHoldModeRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const lastDownAtRef = useRef(0);

  // lang broadcasting
  const getGlobalLang = (): Lang => {
    if (typeof window === "undefined") return lang;
    const g = (window as any).__WAITER_LANG__;
    return g === "bn" || g === "en" || g === "auto" ? g : lang;
  };
  const [currentLang, setCurrentLang] = useState<Lang>(getGlobalLang());

  useEffect(() => {
    setCurrentLang(getGlobalLang()); // on mount
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        const next = detail?.lang;
        if (next === "bn" || next === "en" || next === "auto") {
          setCurrentLang(next);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ t: "set_lang", lang: next }));
          }
        }
      } catch {}
    };
    window.addEventListener("qravy:lang", handler as EventListener);
    return () => window.removeEventListener("qravy:lang", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCurrentLang(getGlobalLang());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // WebAudio + WS refs
  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);

  // ---------- Cleanup ----------
  const cleanup = useCallback(async () => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try { wsRef.current.send(JSON.stringify({ t: "end" })); } catch {}
      }
      if (nodeRef.current) {
        try { nodeRef.current.port.onmessage = null as any; } catch {}
        try { nodeRef.current.disconnect(); } catch {}
      }
      if (srcRef.current) {
        try { srcRef.current.disconnect(); } catch {}
      }
      if (acRef.current) {
        try { await acRef.current.close(); } catch {}
      }
      if (mediaRef.current) {
        try { mediaRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      }
    } catch {}

    wsRef.current = null;
    nodeRef.current = null;
    srcRef.current = null;
    acRef.current = null;
    mediaRef.current = null;
    setThinking(false);
    setPartial("");
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      pointerActiveRef.current = false;
      isHoldModeRef.current = false;
    };
  }, [cleanup]);

  // ---------- speak-once guard (allow modal to speak as well) ----------
  function shouldSpeakOnce(text: string): boolean {
    // 🔧 changed: allow modal to speak too (no willOwnLiveRef gate)
    if (typeof window === "undefined") return true;
    const key = text.trim();
    const now = performance.now();
    const lastKey = window.__QRAVY_LAST_SPOKEN__;
    const lastAt  = window.__QRAVY_LAST_SPOKEN_AT__ ?? 0;
    if (lastKey === key && now - lastAt < 8000) return false;
    window.__QRAVY_LAST_SPOKEN__ = key;
    window.__QRAVY_LAST_SPOKEN_AT__ = now;
    return true;
  }

  // ---------- WebSocket ----------
  const openWebSocket = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const sid = getStableSessionId();
    const url = getWsURL(wsPath);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            t: "hello",
            sessionId: sid,
            userId: "guest",
            rate: 16000,
            ch: 1,
            lang: currentLang,
            tenant: tenant ?? undefined,
            branch: branch ?? undefined,
            channel: channel ?? undefined,
          })
        );
      } catch {}
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.t === "stt_partial") {
          return;
        }

        if (data.t === "ai_reply_pending") {
          setThinking(true);
          setAi("Thinking…");
          return;
        }

        if (data.t === "ai_reply") {
          setThinking(false);
          const replyText = data.replyText || "";

          // Do NOT push full text into global live; TTS word callbacks will reveal it.
          setAiText((prev) => (prev ? `${prev} ${replyText}` : replyText));

          // Speak (deduped globally)
          try {
            if (shouldSpeakOnce(replyText)) {
              tts.speak(replyText);
            }
          } catch {}

          onAiReply?.({ replyText, meta: data.meta });
          return;
        }
      } catch {
        // ignore non-JSON or binary frames
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    wsRef.current = ws;
  }, [branch, channel, currentLang, onAiReply, onPartial, tenant, wsPath, tts]);

  // ---------- Start Recording ----------
  const start = useCallback(async () => {
    if (disabled || isRecording) return;
    setIsRecording(true);
    setPartial("");
    setThinking(false);
    setAiText("");

    try { getTTS().duck(); } catch {}

    openWebSocket();

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac = new AC({ sampleRate: 48000 });
    acRef.current = ac;

    await ac.audioWorklet.addModule("/worklets/audio-capture.worklet.js");

    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    mediaRef.current = media;

    const src = ac.createMediaStreamSource(media);
    srcRef.current = src;

    const node = new AudioWorkletNode(ac, "capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
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
  }, [disabled, isRecording, openWebSocket]);

  // ---------- Stop ----------
  const stop = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    await cleanup();
    try { getTTS().unduck(); } catch {}
  }, [cleanup, isRecording]);

  // ---------- Pointer handlers (use the single set of refs above) ----------
  const onPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    pointerActiveRef.current = true;
    isHoldModeRef.current = false;
    lastDownAtRef.current = Date.now();

    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdTimerRef.current = window.setTimeout(async () => {
      if (!pointerActiveRef.current) return;
      isHoldModeRef.current = true;
      if (!isRecording) {
        await start();
      }
    }, HOLD_MS);
  }, [disabled, isRecording, start]);

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
  }, [start, stop]);

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

  // ---------- UI ----------
  const hintText = isRecording
    ? partial
      ? partial
      : "Listening…"
    : thinking
      ? "Thinking…"
      : "Tap to start • Hold to talk";

  // Prefer shared LIVE; fallback to global final; then local buffer
  const subtitle = aiLive || globalAiText || aiText;

  return (
    <div ref={rootRef} className={["relative w-full", className].join(" ")}>
      <div
        className="fixed left-0 right-0 bottom-0 h-40 bg-gradient-to-t from-[#F6F5F8]/100 from-[60%] to-[#F6F5F8]/0 to-[100%]"
        aria-hidden="true"
      />

      <div
        className={[
          "w-full rounded-full bg-white shadow-[0_6px_20px_rgba(255,0,64,0.12)]",
          "border border-white/60 px-4 py-2 flex items-center gap-3",
          "backdrop-blur",
          "relative z-10",
        ].join(" ")}
      >
        {/* live caption / flowing last-2-lines */}
        <div className="grow min-h-6 flex items-center text-sm text-gray-700">
          {isRecording ? (
            partial ? (
              <span className="text-gray-700">{partial}</span>
            ) : (
              "Listening…"
            )
          ) : thinking ? (
            "Thinking…"
          ) : subtitle ? (
            <div className="relative w-full">
              {/* 2-line viewport that sticks to latest lines */}
              <div
                ref={lastLinesRef}
                className="h-[2.8em] leading-snug overflow-y-auto pr-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <div className="whitespace-pre-wrap break-words">{subtitle}</div>
              </div>
              <div className="pointer-events-none absolute -top-1 left-0 right-0 h-3 bg-gradient-to-b from-white to-transparent" />
            </div>
          ) : (
            <img
              src="/icons/wave-idle.svg"
              alt="Idle wave"
              className="h-6 opacity-80 select-none pointer-events-none"
            />
          )}
        </div>

        {/* mic button */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          className={[
            "relative h-12 w-12 shrink-0 rounded-full",
            isRecording ? "bg-rose-600" : "bg-rose-500",
            "flex items-center justify-center text-white",
            "shadow-lg active:scale-95 transition-transform",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
          style={{ touchAction: "manipulation" }}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          title="Tap to toggle • Hold to talk"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 106 0V5a3 3 0 00-3-3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0M12 18v4" />
          </svg>

          {isRecording && <span className="absolute inset-0 rounded-full animate-ping bg-rose-400/40" />}
        </button>
      </div>
    </div>
  );
}
