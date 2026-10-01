// apps/tastebud/src/components/ai-waiter/MicInputBar.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getWsURL, getStableSessionId } from "../../utils/ws";
import { useConversationStore } from "../../state/conversation";
import { useTTS } from "../../state/TTSProvider";
import { getTTS } from "../../state/tts";
import { useCart } from "../../context/CartContext";
import { getTable } from "../../utils/table";
import { waiterLang } from "../../utils/ui-lang";
import { claimReveal, ownsReveal } from "../../state/reveal-owner";
import {
  FOLLOW_UP_LISTEN_MS, PENDING_AUDIO_MAX, chooseOptionsOf, handsFreeOn, wantsFollowUp,
} from "../../utils/handsfree";

type Lang = "bn" | "en" | "auto";

/** Safety net: how long to wait for the waiter's reply after the guest stops talking. */
const REPLY_TIMEOUT_MS = 20_000;
// Hands-free conversation (on unless the guest turned it off): the server hears when they've finished — no tap
// to send — and the mic reopens briefly after a question. Tap / hold still work exactly as before.

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
  /** ids of the dishes on screen right now — "which of these…" is about them */
  shownIds?: string[];
  /** the soft fade over the bottom of the screen — off inside sheets that have their own background */
  floorGradient?: boolean;
  /** extra lift (px) for the reply bubble when something sits above the bar (e.g. a Place-order button) */
  panelLift?: number;
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
  shownIds,
  floorGradient = true,
  panelLift = 0,
}: Props) {
  const shownRef = useRef<string[] | undefined>(shownIds);
  shownRef.current = shownIds;
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  // the same flag, but synchronous — a release that arrives before React re-renders must still stop the mic
  const recRef = useRef(false);
  const maxRecRef = useRef<number | null>(null); // safety cap on one recording
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const serverEndedRef = useRef<(() => void) | null>(null); // hands-free "auto_end" from the server
  const quietCloseRef = useRef<(() => void) | null>(null);  // hands-free "no_speech" from the server
  const [thinking, setThinking] = useState(false);
  const [partial, setPartial] = useState("");

  // Store bits
  const setAi           = useConversationStore((s) => s.setAi);
  const setNotice       = useConversationStore((s) => s.setNotice);
  const aiLive          = useConversationStore((s) => s.aiTextLive);
  const startTtsReveal  = useConversationStore((s) => s.startTtsReveal);
  const appendTtsReveal = useConversationStore((s) => s.appendTtsReveal);
  const finishTtsReveal = useConversationStore((s) => s.finishTtsReveal);

  const tts = useTTS();

  // Only one component writes the spoken words into the live text; a bar inside a pop-up never does
  // (otherwise every word shows twice). See state/reveal-owner.ts.
  const revealIdRef = useRef(Symbol("mic-bar"));
  useEffect(() => {
    const inDialog = !!rootRef.current?.closest('[role="dialog"]');
    if (inDialog) return;
    return claimReveal(revealIdRef.current);
  }, []);
  const ownsLive = () => ownsReveal(revealIdRef.current);

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
    const unsub = tts.subscribe({
      onStart: () => {
        setThinking(false);
        if (!ownsLive()) return;

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

      // @ts-expect-error - the runtime TTS adapter emits a word callback that the current type surface does not declare.
      onWord: (w: string, offsetMs?: number) => {
        if (!ownsLive()) return;
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

      // hands-free: the guest has HEARD the waiter's question (the audio really ended — not "synthesis done",
      // seconds earlier) → listen for the answer. Only the bar that got that reply does this.
      onPlaybackEnd: () => {
        if (followUpRef.current) {
          const askedAt = followUpAtRef.current;
          followUpRef.current = false;
          window.setTimeout(() => {
            if (recRef.current || document.visibilityState !== "visible" || Date.now() - askedAt > 60_000) return;
            void startRef.current?.({ listenMs: FOLLOW_UP_LISTEN_MS });
          }, 350); // let the speaker's last syllable die away first
        }
      },

      onEnd: () => {
        if (!inSpeechRef.current || !ownsLive()) return;
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
  const MAX_RECORDING_MS = 30_000;
  const holdTimerRef = useRef<number | null>(null);
  const isHoldModeRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const lastDownAtRef = useRef(0);
  const startedByPressRef = useRef(false); // this press opened the mic (vs. a tap to stop an open one)

  // language: the guest's choice on the waiter screen (Bangla by default; "auto" → Bangla for the STT hint)
  const getGlobalLang = (): "bn" | "en" => waiterLang();

  const [currentLang, setCurrentLang] = useState<"bn" | "en">(getGlobalLang());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const next = (e as CustomEvent)?.detail?.lang === "en" ? "en" : "bn";
      setCurrentLang(next);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: "set_lang", lang: next }));
      }
    };
    window.addEventListener("qravy:lang", handler as EventListener);
    return () => window.removeEventListener("qravy:lang", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setCurrentLang(getGlobalLang()); // the guest's global choice wins over the prop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // what the guest sees in the tray, and their table — sent with every utterance so the waiter
  // reads back exactly this order (sizes, add-ons, notes) and knows where to bring it
  const { items: cartItems } = useCart();
  const cartRef = useRef(cartItems);
  cartRef.current = cartItems;

  // WS & audio refs
  const wsRef = useRef<WebSocket | null>(null);
  const wsGenRef = useRef(0); // track WS generation to ignore stale handlers
  // audio captured before the socket is open (the first syllable!) is kept and sent right after the hello —
  // it used to be dropped, so "দুইটা দেন" arrived as "টা দেন"
  const pendingAudioRef = useRef<ArrayBuffer[]>([]);

  // the waiter's "which one?" answers as buttons; a tap sends the answer as the guest's words
  type Choice = { label: string; say: string; price?: number };
  const [choices, setChoices] = useState<Choice[]>([]);
  // hands-free: what this recording asks of the server (auto end / a listen window), and a pending follow-up
  const helloExtraRef = useRef<{ autoEnd: boolean; listenMs?: number }>({ autoEnd: false });
  const followUpRef = useRef(false);
  const followUpAtRef = useRef(0);
  const followUpsRef = useRef(0); // listen windows opened in a row without a tap
  const startRef = useRef<((opts?: { listenMs?: number }) => Promise<void>) | null>(null);
  const [listening, setListening] = useState(false); // a follow-up listen window is open ("শুনছি…")
  const workletLoadedRef = useRef<AudioContext | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const persistAcRef = useRef<AudioContext | null>(null); // kept (suspended) between turns — see start()
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
        // suspended, not closed: it was started by a tap, so it may be resumed later WITHOUT one (iOS) — that is
        // what lets the mic reopen by itself after the waiter's question
        try { await acRef.current.suspend(); } catch {}
      }
    } catch {}
    nodeRef.current = null;
    srcRef.current = null;
    acRef.current = null;
    mediaRef.current = null;
    setPartial("");
  }, []);

  // "Thinking…" lasts from release until ai_reply; if that never comes, recover instead of hanging
  const awaitingRef = useRef(false);
  const captureGenRef = useRef(0); // bumps on every press and release — a slow mic start after release is dropped
  const watchdogRef = useRef<number | null>(null);
  const giveUpWaiting = useCallback(() => {
    if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (!awaitingRef.current) return;
    awaitingRef.current = false;
    setThinking(false);
    try {
      setNotice(waiterLang() === "en"
        ? "Sorry, I didn't get that — please say it again."
        : "দুঃখিত, বুঝতে পারিনি — আরেকবার বলবেন?");
    } catch {}
  }, [setAi]);

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
    if (maxRecRef.current) { window.clearTimeout(maxRecRef.current); maxRecRef.current = null; }
    recRef.current = false;
    setIsRecording(false);
    setThinking(false);
    setListening(false);
    setPartial("");
  }, [stopCaptureOnly]);

    // speak dedupe
  function shouldSpeakOnce(text: string): boolean {
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

      // 👇 IMPORTANT: send `hello` immediately on open
      const startMsg: any = {
        t: "hello",                 // 👈 changed from "start" to "hello"
        sessionId: sid,
        userId: "guest",
        rate: 16000,
        ch: 1,
        lang: currentLang,
        tenant: tenant ?? undefined,
        branch: branch ?? undefined,
        channel: channel ?? undefined,
        tz,
        localHour,
        table: getTable(tenant) ?? undefined,
        cart: cartRef.current,
        shown: shownRef.current ?? [],
        // hands-free: the server ends the turn when the guest stops talking (and closes a listen window quietly)
        autoEnd: helloExtraRef.current.autoEnd,
        listenMs: helloExtraRef.current.listenMs,
      };
      try { ws.send(JSON.stringify(startMsg)); } catch {}
      // …then the audio that was recorded while the socket was still connecting
      const held = pendingAudioRef.current;
      pendingAudioRef.current = [];
      for (const buf of held) {
        try { ws.send(buf); } catch {}
      }

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

        // hands-free: the server heard the guest stop talking → it's answering (no tap needed)
        if (data.t === "auto_end") {
          serverEndedRef.current?.();
          return;
        }
        // hands-free: a listen window passed and nobody spoke → close quietly (no reply, no "sorry")
        if (data.t === "no_speech") {
          quietCloseRef.current?.();
          return;
        }
        if (data.t === "speech_start") {
          setListening(false); // they're talking now — the bar shows the recording waves
          return;
        }

        if (data.t === "ai_reply_pending") {
          setThinking(true);
          setAi("Thinking…");
          tts.warm(); // voice connected while the waiter thinks
          return;
        }

        if (data.t === "ai_reply") {
          const meta = data.meta || {};
          const replyText = (data.replyText || "").toString().trim();
          const voiceText = (meta.voiceReplyText || "").toString().trim();
          const speakText = voiceText || replyText;

          if (speakText && shouldSpeakOnce(speakText)) {
            tts.speak(speakText).catch((err) => {
              console.warn("[MicInputBar] TTS speak failed, showing text directly:", err);
              setAi(speakText);
            });
          } else if (replyText) {
            setAi(replyText);
          }

          setThinking(false);
          awaitingRef.current = false;
          if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }

          console.log("[AI RAW][MicInputBar]", { replyText, voiceText, meta });

          setChoices(chooseOptionsOf(meta));

          // hands-free: the waiter asked something → when it finishes speaking, listen for the answer
          // (never after "didn't catch that", at most MAX_FOLLOW_UPS in a row without a tap — see utils/handsfree)
          followUpRef.current = wantsFollowUp(replyText, meta, followUpsRef.current);
          followUpAtRef.current = Date.now();

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
          giveUpWaiting();
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
      if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      awaitingRef.current = false;
      hardReset();
      // e.g. the voice service is restarting — say so instead of silently doing nothing
      try {
        setNotice(waiterLang() === "en"
          ? "Can't connect right now — please try the mic again in a few seconds."
          : "এই মুহূর্তে সংযোগ হচ্ছে না — কয়েক সেকেন্ড পরে আবার মাইক চাপুন।");
      } catch {}
    };

    ws.onclose = () => {
      if (wsGenRef.current !== myGen) return;
      if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }

      // closed without a reply while showing "Thinking…" (nothing heard, server error) → recover
      giveUpWaiting();

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
    giveUpWaiting,
    isRecording,
    thinking,
    onAiReply,
    onPartial,
    tenant,
    tts,
    setAi,
    wsPath,
  ]);

  // Start capture. `listenMs`: a hands-free listen window after the waiter's question (not a tap) — nobody speaks
  // within it → closed quietly; a failure to open the mic then is silent (the guest didn't ask for it).
  const start = useCallback(async (opts?: { listenMs?: number }) => {
    if (disabled || recRef.current) return;
    const followUp = !!opts?.listenMs;
    if (!followUp) {
      followUpRef.current = false; // the guest tapped — no pending follow-up any more
      followUpsRef.current = 0;
    } else {
      followUpsRef.current += 1;
    }
    helloExtraRef.current = { autoEnd: handsFreeOn(), listenMs: opts?.listenMs };
    setListening(followUp);
    recRef.current = true;
    setIsRecording(true);
    // never record forever (a lost "release" on iOS left the mic open for minutes)
    if (maxRecRef.current) window.clearTimeout(maxRecRef.current);
    maxRecRef.current = window.setTimeout(() => { stopRef.current?.(); }, MAX_RECORDING_MS);
    const myCap = ++captureGenRef.current;
    const released = () => captureGenRef.current !== myCap;

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    try { setAi(""); } catch {}
    setThinking(false);
    setPartial("");
    setChoices([]); // talking instead of tapping a choice — the question is answered by voice
    pendingAudioRef.current = [];

    try { getTTS().duck(); } catch {}

    openWebSocket();

    // one audio context for the whole visit (created on the first tap, suspended between turns): iOS only lets
    // a context started by a tap be resumed later without one
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const kept = persistAcRef.current;
    const ac: AudioContext = kept && kept.state !== "closed" ? kept : new AC({ sampleRate: 48000 });
    persistAcRef.current = ac;
    acRef.current = ac;

    if (workletLoadedRef.current !== ac) {
      try {
        await ac.audioWorklet.addModule("/worklets/audio-capture.worklet.js");
        workletLoadedRef.current = ac;
      } catch {
        if (!released()) await hardReset(); // the worklet failed — don't sit in "recording"
        return;
      }
    }
    if (released()) return;

    // ensure audio context is running so worklet can process
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch {}
    }

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch {
      // mic blocked / not allowed → say so instead of pretending to listen (a follow-up the guest didn't ask for
      // just doesn't happen)
      if (!released()) {
        await hardReset();
        if (followUp) return;
        try {
          setNotice(waiterLang() === "en"
            ? "I can't hear you — please allow microphone access and try again."
            : "মাইক্রোফোন চালু করা যাচ্ছে না — মাইকের অনুমতি দিয়ে আবার চেষ্টা করুন।");
        } catch {}
      }
      return;
    }
    if (released()) {
      // released while the browser was opening the mic → don't leave it capturing
      try { media.getTracks().forEach((t) => t.stop()); } catch {}
      return;
    }
    mediaRef.current = media;

    const src = ac.createMediaStreamSource(media);
    srcRef.current = src;

    const node = new AudioWorkletNode(ac, "capture-processor", { numberOfInputs: 1, numberOfOutputs: 0 });
    nodeRef.current = node;

    node.port.postMessage({ type: "configure", frameMs: 20 });

    node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      const buf: ArrayBuffer | null =
        (msg as any).type === "chunk" && (msg as any).samples instanceof Int16Array
          ? (msg as any).samples.buffer
          : msg instanceof ArrayBuffer ? msg : null;
      if (!buf) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buf);
      } else if (ws && ws.readyState === WebSocket.CONNECTING && pendingAudioRef.current.length < PENDING_AUDIO_MAX) {
        pendingAudioRef.current.push(buf); // sent right after the hello (see onopen)
      }
    };

    src.connect(node);
  }, [disabled, isRecording, openWebSocket, finishTtsReveal, startTtsReveal, setAi, hardReset]);
  startRef.current = start;

  // Stop capture → show Thinking immediately, keep WS to receive reply.
  // `serverEnded`: the server already heard the guest finish (hands-free) — it's answering; don't send "end".
  const stop = useCallback(async (serverEnded = false) => {
    if (!recRef.current) return;
    recRef.current = false;
    if (maxRecRef.current) { window.clearTimeout(maxRecRef.current); maxRecRef.current = null; }
    setIsRecording(false);
    setListening(false);
    captureGenRef.current++;

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    setThinking(true);
    setAi("Thinking…");
    awaitingRef.current = true;

    // tell server no more audio, but keep WS open for ai_reply
    const ws = wsRef.current;
    try {
      if (serverEnded) {
        // the server is already finishing this turn
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "end" }));
      } else if (ws && ws.readyState === WebSocket.CONNECTING) {
        // a quick tap: released before the socket opened → send "end" right after the hello
        ws.addEventListener("open", () => {
          try { ws.send(JSON.stringify({ t: "end" })); } catch {}
        }, { once: true });
      } else {
        // no socket to answer us → don't show "Thinking…" at all
        window.setTimeout(() => giveUpWaiting(), 0);
      }
    } catch {}
    // safety net: no reply in time (or nothing was heard) → don't hang on "Thinking…"
    if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    watchdogRef.current = window.setTimeout(() => {
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
      } catch {}
      giveUpWaiting();
    }, REPLY_TIMEOUT_MS);

    await stopCaptureOnly();
    try { getTTS().unduck(); } catch {}
  }, [isRecording, setAi, startTtsReveal, finishTtsReveal, stopCaptureOnly, giveUpWaiting]);
  stopRef.current = stop;
  serverEndedRef.current = () => { void stop(true); };

  // hands-free: nobody answered in the listen window → close quietly, as if the mic had never opened
  const quietClose = useCallback(async () => {
    if (!recRef.current) return;
    recRef.current = false;
    if (maxRecRef.current) { window.clearTimeout(maxRecRef.current); maxRecRef.current = null; }
    setIsRecording(false);
    setListening(false);
    captureGenRef.current++;
    const ws = wsRef.current;
    try {
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      }
    } catch {}
    if (wsRef.current === ws) wsRef.current = null;
    if (pingTimerRef.current) { window.clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    await stopCaptureOnly();
    try { getTTS().unduck(); } catch {}
  }, [stopCaptureOnly]);
  quietCloseRef.current = () => { void quietClose(); };

  // A tapped answer to "which one?": sent as the guest's words — no speech recognition, so nothing is misheard
  const sendSay = useCallback((text: string) => {
    if (disabled || recRef.current || !text.trim()) return;
    setChoices([]);
    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    setThinking(true);
    setAi("Thinking…");
    awaitingRef.current = true;
    openWebSocket();
    const ws = wsRef.current;
    // (after the hello, which the socket's own onopen sends first)
    ws?.addEventListener("open", () => {
      try { ws.send(JSON.stringify({ t: "say", text })); } catch {}
    }, { once: true });
    if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
    watchdogRef.current = window.setTimeout(() => {
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
      } catch {}
      giveUpWaiting();
    }, REPLY_TIMEOUT_MS);
  }, [disabled, openWebSocket, giveUpWaiting, setAi, startTtsReveal, finishTtsReveal]);

  // Unmount → full reset (and the kept audio context is really closed)
  useEffect(() => {
    return () => {
      followUpRef.current = false;
      hardReset();
      try { void persistAcRef.current?.close(); } catch {}
      persistAcRef.current = null;
    };
  }, [hardReset]);

  // Pointer handlers
  const onPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    // keep this press's pointer on the button (a finger drifting off must still "release" here)
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
    pointerActiveRef.current = true;
    isHoldModeRef.current = false;
    lastDownAtRef.current = Date.now();

    try { startTtsReveal(""); finishTtsReveal(); } catch {}
    try { setAi(""); } catch {}

    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    // the mic opens on TOUCH, not 250 ms later: people start talking as they press, and the first syllable
    // ("দুইটা…") was lost. Holding past HOLD_MS = push-to-talk (stops on release); a quick tap keeps it on.
    startedByPressRef.current = !recRef.current;
    if (!recRef.current) void start();
    holdTimerRef.current = window.setTimeout(() => {
      if (!pointerActiveRef.current) return;
      isHoldModeRef.current = true;
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
      // a quick tap: this press started the mic → it stays on (tap again to send); it was already on → send
      if (!startedByPressRef.current && recRef.current) {
        await stop();
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

  // iOS cancels the touch (mic permission sheet, audio-session switch, a tiny scroll) instead of lifting it:
  // a hold ends like a release; a tap that got cancelled simply didn't happen
  const onPointerCancel = useCallback(async () => {
    if (disabled || !pointerActiveRef.current) return;
    if (isHoldModeRef.current) {
      await endPressCycle();
      return;
    }
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    pointerActiveRef.current = false;
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
      {/* Soft floor gradient (never over buttons above the bar in a sheet) */}
      {floorGradient && (
        <div
          className="pointer-events-none fixed left-0 right-0 bottom-0 h-40 bg-gradient-to-t from-[#F6F5F8]/100 from-[60%] to-[#F6F5F8]/0 to-[100%]"
          aria-hidden="true"
        />
      )}

      <div className="relative">
        {/* EXPANDABLE AI RESPONSE PANEL (slides above the bar) */}
        <div
          className={[
            "absolute bottom-full left-0 right-0 z-[70] mb-3 transition-all duration-500 ease-out",
            showExpanded ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-4 scale-95 pointer-events-none",
          ].join(" ")}
          style={panelLift ? { marginBottom: 12 + panelLift } : undefined}
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

        {/* "WHICH ONE?" — the waiter's options as buttons; one tap answers (sent as the guest's words) */}
        {choices.length > 0 && !isRecording && !thinking && (
          <div className="relative z-[60] mb-2 flex flex-wrap justify-center gap-2" role="group" aria-label="Choose one">
            {choices.map((c) => (
              <button
                key={c.say}
                type="button"
                onClick={() => sendSay(c.say)}
                className="max-w-full truncate rounded-full border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 shadow-sm transition active:scale-95 hover:border-rose-300"
              >
                {c.label}
                {typeof c.price === "number" && (
                  <span className="ml-1.5 font-normal text-gray-500">৳{c.price}</span>
                )}
              </button>
            ))}
          </div>
        )}

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
                {isRecording && listening ? (
                  // hands-free: the waiter asked something and is waiting for the answer
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-semibold text-white animate-pulse">Listening… just answer</span>
                    <span className="text-[11px] text-white/80">hold the phone near your mouth</span>
                  </span>
                ) : isRecording ? (
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
              onPointerCancel={onPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              className={[
                "relative h-12 w-12 shrink-0 rounded-full transition-all duration-200 flex items-center justify-center",
                isRecording
                  ? "bg-white text-[#FA2851] scale-110 shadow-xl"
                  : "bg-gradient-to-br from-[#FF8EA3] via-[#FA2851] to-[#D91440] text-white hover:scale-105 active:scale-95 shadow-lg",
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
              style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
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
