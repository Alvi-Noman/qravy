// apps/tastebud/src/components/ai-waiter/MicInputBar.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getWsURL, getStableSessionId } from "../../utils/ws";

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

export default function MicInputBar({
  className = "",
  tenant,
  branch,
  channel,
  lang = "bn",           // ✅ default Bangla
  wsPath = "/ws/voice",  // ✅ same as AiWaiterHome
  onAiReply,
  onPartial,
  disabled = false,
}: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [partial, setPartial] = useState("");

  // 🔗 Keep a current language that follows AiWaiterHome broadcasts
  const getGlobalLang = (): Lang => {
    if (typeof window === "undefined") return lang;
    const g = (window as any).__WAITER_LANG__;
    return g === "bn" || g === "en" || g === "auto" ? g : lang;
  };
  const [currentLang, setCurrentLang] = useState<Lang>(getGlobalLang());

  // react to external (global) lang changes from AiWaiterHome
  useEffect(() => {
    setCurrentLang(getGlobalLang()); // sync on mount
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        const next = detail?.lang;
        if (next === "bn" || next === "en" || next === "auto") {
          setCurrentLang(next);
          // live-update server if WS is open
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

  // if parent explicitly changes prop lang, reflect (global still wins when broadcast fires)
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
      // Ask server to finalize
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ t: "end" }));
        } catch {}
      }

      // Tear down audio graph
      if (nodeRef.current) {
        try {
          nodeRef.current.port.onmessage = null as any;
        } catch {}
        try {
          nodeRef.current.disconnect();
        } catch {}
      }

      if (srcRef.current) {
        try {
          srcRef.current.disconnect();
        } catch {}
      }

      if (acRef.current) {
        try {
          await acRef.current.close();
        } catch {}
      }

      if (mediaRef.current) {
        try {
          mediaRef.current.getTracks().forEach((t) => t.stop());
        } catch {}
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
    };
  }, [cleanup]);

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
            lang: currentLang, // ✅ reflect global/selected language
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
          setPartial(data.text || "");
          onPartial?.(data.text || "");
        } else if (data.t === "ai_reply_pending") {
          setThinking(true);
        } else if (data.t === "ai_reply") {
          setThinking(false);
          const replyText = data.replyText || "";
          onAiReply?.({ replyText, meta: data.meta });
        }
      } catch {
        // ignore non-JSON or binary
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    wsRef.current = ws;
  }, [branch, channel, currentLang, onAiReply, onPartial, tenant, wsPath]);

  // ---------- Start Recording ----------
  const start = useCallback(async () => {
    if (disabled || isRecording) return;
    setIsRecording(true);
    setPartial("");
    setThinking(false);

    openWebSocket();

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac = new AC({ sampleRate: 48000 });
    acRef.current = ac;

    // Load worklet
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

    // ✅ Use correct processor name
    const node = new AudioWorkletNode(ac, "capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    nodeRef.current = node;

    node.port.postMessage({ type: "configure", frameMs: 20 });

    // Forward PCM frames
    node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (msg.type === "chunk" && msg.samples instanceof Int16Array) {
        ws.send(msg.samples.buffer);
      } else if (msg instanceof ArrayBuffer) {
        ws.send(msg);
      }
    };

    src.connect(node);
  }, [disabled, isRecording, openWebSocket]);

  // ---------- Stop ----------
  const stop = useCallback(async () => {
    setIsRecording(false);
    await cleanup();
  }, [cleanup]);

  // ---------- Event handlers ----------
  const onPointerDown = useCallback(async () => {
    await start();
  }, [start]);

  const onPointerUp = useCallback(async () => {
    await stop();
  }, [stop]);

  const onPointerLeave = useCallback(async () => {
    if (isRecording) await stop();
  }, [isRecording, stop]);

  const onClickToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) await stop();
      else await start();
    },
    [isRecording, start, stop]
  );

  // ---------- UI ----------
  return (
    <div
      className={[
        "w-full rounded-full bg-white shadow-[0_6px_20px_rgba(255,0,64,0.12)]",
        "border border-white/60 px-4 py-2 flex items-center gap-3",
        "backdrop-blur",
        className,
      ].join(" ")}
    >
      {/* live caption / hint */}
      <div className="grow min-h-6 text-sm text-gray-500">
        {isRecording
          ? partial
            ? <span className="text-gray-700">{partial}</span>
            : "Listening…"
          : thinking
            ? "Thinking…"
            : "Hold to speak or tap to toggle"}
      </div>

      {/* mic button */}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={onClickToggle}
        className={[
          "relative h-12 w-12 shrink-0 rounded-full",
          isRecording ? "bg-rose-600" : "bg-rose-500",
          "flex items-center justify-center text-white",
          "shadow-lg active:scale-95 transition-transform",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        style={{ touchAction: "manipulation" }}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        title={isRecording ? "Release to send" : "Hold to speak"}
      >
        {/* mic icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 2a3 3 0 00-3 3v6a3 3 0 106 0V5a3 3 0 00-3-3z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-14 0M12 18v4"
          />
        </svg>

        {/* halo while recording */}
        {isRecording && (
          <span className="absolute inset-0 rounded-full animate-ping bg-rose-400/40" />
        )}
      </button>
    </div>
  );
}
