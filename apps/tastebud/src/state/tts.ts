// apps/tastebud/src/state/tts.ts
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

type QueueItem = { id: string; text: string; resolve: () => void; reject: (e: any) => void };

export type TtsEvents = {
  onStart?: (originalText: string) => void;
  onWord?: (word: string, offsetMs?: number) => void;   // ⬅️ now includes audio offset
  onEnd?: () => void;                                    // after audio completes or is stopped
};

export type TTSPublicAPI = {
  speak: (text: string) => Promise<void>;
  /** Get a connected speech pipeline ready in the background (call while the waiter is thinking). */
  warm: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  duck: () => void;     // ⬅️ NEW
  unduck: () => void;   // ⬅️ NEW
  setVoice: (shortName: string) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (vol01: number) => void; // 0..1
  getMuted: () => boolean;
  getVolume: () => number; // 0..1
  getVoice: () => string;

  /** Subscribe to synthesis lifecycle; returns unsubscribe */
  subscribe: (handlers: TtsEvents) => () => void;
};

const TOKEN_URL = import.meta.env.VITE_SPEECH_TOKEN_URL || "/azure/speech-token";
const DEFAULT_VOICE = import.meta.env.VITE_AZURE_SPEECH_VOICE || "bn-BD-PradeepNeural";

const LS_MUTED = "tts.muted";
const LS_VOLUME = "tts.volume"; // 0..1
const LS_VOICE = "tts.voice";

const TOKEN_REFRESH_MS = 9 * 60 * 1000; // refresh a bit before 10m
const MIN_AUDIBLE = 0.05;               // never let live output go below 5% if not muted
const SPARE_MAX_AGE_MS = 4 * 60 * 1000; // a pre-connected pipeline older than this is rebuilt

type Pipeline = {
  speechConfig: sdk.SpeechConfig;
  speaker: sdk.SpeakerAudioDestination;
  audioConfig: sdk.AudioConfig;
  synthesizer: sdk.SpeechSynthesizer;
  voice: string;
  builtAt: number;
};

/* ---------- Bangla pronunciation fixes ---------- */
// The Bangla voice guesses the unwritten "o" (inherent vowel) wrong on some words: "স্বাগতম" → "shagtom",
// "ঝাল" → "jhalo". It is fed a respelling that forces the right sound (explicit ো / hasant ্); the word
// events are mapped back so the screen still shows the normal spelling. Whole words only.
const BN_SAY: Array<[written: string, said: string]> = [
  ["স্বাগতম", "স্বাগোতম"], // shagotom, not shagtom
  ["ঝাল", "ঝাল্"], // jhal, not jhalo
];
const BN_LETTER = "ঀ-৿";
const wholeWord = (w: string) => new RegExp(`(?<![${BN_LETTER}])${w}(?![${BN_LETTER}])`, "g");
const BN_SAY_RE = BN_SAY.map(([written, said]) => ({ to: wholeWord(written), said, back: wholeWord(said), written }));

function forSpeech(text: string): string {
  return BN_SAY_RE.reduce((t, r) => t.replace(r.to, r.said), text);
}

function fromSpeech(word: string): string {
  return BN_SAY_RE.reduce((t, r) => t.replace(r.back, r.written), word);
}

/* ---------- SSML helpers ---------- */
function isLikelySsml(s: string) {
  const t = (s ?? "").trim().toLowerCase();
  return t.startsWith("<speak") && t.includes("</speak>");
}

// Light Bangla-aware SSML wrapper:
// - Converts common currency notations to <say-as currency>
// - Inserts micro breaks after sentence-ending punctuation
function buildBanglaSsml(text: string, voiceName: string) {
  const normalized = (text ?? "")
    // ৳240 or 240৳ → currency
    .replace(/৳\s*([0-9]+(?:\.[0-9]+)?)/g, (_m, n) => `<say-as interpret-as="currency">${n}</say-as>`)
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*৳/g, (_m, n) => `<say-as interpret-as="currency">${n}</say-as>`)
    // Breaks after Bangla/English sentence endings
    .replace(/([।!?])\s*/g, '$1<break time="200ms"/> ')
    .replace(/([.!?])\s*/g, '$1<break time="200ms"/> ');

  // ❌ No <lang> wrapper to avoid “Ssml should only contain one language”
  return `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis">
  <voice name="${voiceName}">
    ${normalized}
  </voice>
</speak>`.trim();
}

// ✅ Ensure SSML contains only one language (strip <lang> and xml:lang attrs)
function sanitizeSingleLanguageSsml(ssml: string) {
  return ssml
    .replace(/<\s*lang\b[^>]*>/gi, "")
    .replace(/<\s*\/\s*lang\s*>/gi, "")
    .replace(/\s+xml:lang="[^"]*"/gi, "")
    .replace(/\s+xml:lang='[^']*'/gi, "");
}

// Derive locale (e.g., "bn-IN") from a voice like "bn-IN-BashkarNeural"
function localeFromVoice(voiceName: string): string {
  const parts = (voiceName || "").split("-");
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return "en-US"; // safe fallback
}

function loadMuted(): boolean {
  try {
    const v = localStorage.getItem(LS_MUTED);
    return v === "1";
  } catch { return false; }
}
function loadVolume(): number {
  try {
    const v = localStorage.getItem(LS_VOLUME);
    const n = v ? Number(v) : 1;
    if (Number.isNaN(n)) return 1;
    return Math.min(1, Math.max(0, n));
  } catch { return 1; }
}
function loadVoice(): string {
  try {
    return localStorage.getItem(LS_VOICE) || DEFAULT_VOICE;
  } catch { return DEFAULT_VOICE; }
}

/** Version-tolerant helper for cancellation details across SDK variants. */
function getSynthesisCancelDetails(result: sdk.SpeechSynthesisResult): {
  reason?: any;
  errorCode?: any;
  errorDetails?: string | undefined;
} {
  const anySdk: any = sdk as any;

  // Prefer SpeechSynthesisCancellationDetails (newer SDKs)
  const klass =
    anySdk.SpeechSynthesisCancellationDetails ||
    anySdk.CancellationDetails ||
    anySdk.SynthesisCancellationDetails;

  if (klass && typeof klass.fromResult === "function") {
    try {
      return klass.fromResult(result);
    } catch {
      // fall through to manual extraction
    }
  }
  // Best-effort fallback fields (may be undefined on some versions)
  return {
    reason: (result as any).reason,
    errorCode: (result as any).errorCode,
    errorDetails: (result as any).errorDetails,
  };
}

class TTSManager implements TTSPublicAPI {
  private static _instance: TTSManager | null = null;

  static get instance(): TTSManager {
    if (!this._instance) this._instance = new TTSManager();
    return this._instance;
  }

  private authToken = "";
  private region = "";
  private tokenFetchedAt = 0;

  private speechConfig: sdk.SpeechConfig | null = null;
  private speaker: sdk.SpeakerAudioDestination | null = null;
  private audioConfig: sdk.AudioConfig | null = null;
  private synthesizer: sdk.SpeechSynthesizer | null = null;

  // Built + connected ahead of time, so the next reply doesn't wait on setup (stop() tears the live one down)
  private spare: Pipeline | null = null;

  private queue: QueueItem[] = [];
  private playing = false;
  private paused = false;

  private muted = loadMuted();
  private volume01 = loadVolume();
  private voice = loadVoice();

  // Track current utterance text for event callbacks
  private currentUtteranceText = "";

  // Ducking state
  private ducked = false;
  private preDuckVolume01: number | null = null;

  // Event subscribers
  private listeners = new Set<TtsEvents>();

  private constructor() {}

  // ---------- public API ----------
  getMuted() { return this.muted; }
  getVolume() { return this.volume01; }
  getVoice() { return this.voice; }

  subscribe = (h: TtsEvents) => {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  };

  setMuted(muted: boolean) {
    this.muted = !!muted;
    try { localStorage.setItem(LS_MUTED, this.muted ? "1" : "0"); } catch {}
    if (this.speaker) this._applySpeakerVolume();
  }

  setVolume(vol01: number) {
    const v = Math.min(1, Math.max(0, Number(vol01)));
    this.volume01 = v;
    try { localStorage.setItem(LS_VOLUME, String(v)); } catch {}
    if (this.speaker) this._applySpeakerVolume();
  }

  setVoice(shortName: string) {
    this.voice = shortName || DEFAULT_VOICE;
    try { localStorage.setItem(LS_VOICE, this.voice); } catch {}
    if (this.speechConfig) this.speechConfig.speechSynthesisVoiceName = this.voice;
  }

  async speak(text: string): Promise<void> {
    const clean = (text ?? "").trim();
    if (!clean) return;

    await this._ensureReady();

    return new Promise<void>((resolve, reject) => {
      const item: QueueItem = { id: crypto.randomUUID(), text: clean, resolve, reject };
      this.queue.push(item);
      this._pump();
    });
  }

  warm = () => {
    this._warm().catch((e) => console.debug("[TTS] warm-up skipped", e));
  };

  stop() {
    // Cancel current + future items
    this.paused = false;
    const q = this.queue.splice(0);
    q.forEach((it) => it.reject(new Error("stopped")));

    // Pause speaker (halts playback), then close synthesizer to fully stop
    try { this.speaker?.pause(); } catch {}
    try { this.synthesizer?.close(); } catch {}
    // Drop current audio pipeline so next speak() re-initializes cleanly
    this.synthesizer = null;
    this.audioConfig = null;
    this.speaker = null;
    this.speechConfig = null;

    this.playing = false;

    // Notify listeners that playback ended
    this._emitEnd();
  }

  pause() {
    try { this.speaker?.pause(); } catch {}
    this.paused = true;
    this.playing = false;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    try { this.speaker?.resume(); } catch {}
    if (!this.playing) this._pump();
  }

  // ⬇️⬇️ Ducking API
  duck() {
    if (this.ducked) return;
    this.ducked = true;

    if (this.preDuckVolume01 === null) this.preDuckVolume01 = this.volume01;
    const target = Math.min(this.volume01, 0.15);
    if (!this.muted) {
      try {
        if (this.speaker) this.speaker.volume = Math.round(Math.max(target, MIN_AUDIBLE) * 100);
      } catch {}
    }
  }

  unduck() {
    if (!this.ducked) return;
    this.ducked = false;

    const restore = this.preDuckVolume01 ?? this.volume01;
    this.preDuckVolume01 = null;

    if (!this.muted) {
      try {
        if (this.speaker) this.speaker.volume = Math.round(Math.max(restore, MIN_AUDIBLE) * 100);
      } catch {}
    }
  }
  // ↑↑↑ Ducking API

  // ---------- internals ----------
  private _emitStart(text: string) {
    this.listeners.forEach(h => { h.onStart?.(text); });
  }
  private _emitWord(word: string, offsetMs?: number) {
    if (!word) return;
    // the speech engine reports SSML-escaped text ("&amp;") — show what was actually said
    const shown = word
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    this.listeners.forEach(h => { h.onWord?.(fromSpeech(shown), offsetMs); });
  }
  private _emitEnd() {
    this.listeners.forEach(h => { h.onEnd?.(); });
  }

  private async _ensureToken() {
    // Token valid?
    if (!this.authToken || (Date.now() - this.tokenFetchedAt) > TOKEN_REFRESH_MS) {
      const { token, region } = await this._fetchToken();
      this.authToken = token;
      this.region = region;
      this.tokenFetchedAt = Date.now();
    }
  }

  private _spareUsable(): boolean {
    const p = this.spare;
    return !!p && p.voice === this.voice && Date.now() - p.builtAt < SPARE_MAX_AGE_MS;
  }

  private _dropSpare() {
    const p = this.spare;
    this.spare = null;
    if (!p) return;
    try { p.synthesizer.close(); } catch {}
    try { p.speaker.close(); } catch {}
  }

  private async _warm() {
    await this._ensureToken();
    if (this._spareUsable()) return;
    this._dropSpare();
    const p = this._buildPipeline();
    this.spare = p;
    // open the service connection now instead of on the first word
    try { sdk.Connection.fromSynthesizer(p.synthesizer).openConnection(); } catch {}
  }

  private async _ensureReady() {
    await this._ensureToken();

    // Already initialized?
    if (this.synthesizer) return;

    let p: Pipeline;
    if (this._spareUsable()) {
      p = this.spare!;
      this.spare = null;
      p.speechConfig.authorizationToken = this.authToken;
    } else {
      this._dropSpare();
      p = this._buildPipeline();
    }
    this.speechConfig = p.speechConfig;
    this.speaker = p.speaker;
    this.audioConfig = p.audioConfig;
    this.synthesizer = p.synthesizer;
    this._applySpeakerVolume();
  }

  private _buildPipeline(): Pipeline {
    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(this.authToken, this.region);

    // Voice + explicit language to match the voice locale (prevents multi-language SSML)
    speechConfig.speechSynthesisVoiceName = this.voice;
    speechConfig.speechSynthesisLanguage = localeFromVoice(this.voice);

    // ✅ Request word-boundary events with a boolean string
    try {
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary, "true");
    } catch {}

    // ✅ Choose a browser-friendly output format to avoid device quirks
    try {
      speechConfig.speechSynthesisOutputFormat =
        sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    } catch {}

    // Speaker we can volume-control (volume is applied when the pipeline goes live)
    const speaker = new sdk.SpeakerAudioDestination();
    const audioConfig = sdk.AudioConfig.fromSpeakerOutput(speaker);

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    // ✅ Attach both PascalCase and camelCase handlers for SDK compatibility
    try {
      const onStart = (_s: any, e: any) => {
        console.debug("[TTS] SynthesisStarted", e);
        // Mirror lifecycle to subscribers
        this._emitStart(this.currentUtteranceText);
      };
      const onComplete = (_s: any, e: any) => {
        console.debug("[TTS] SynthesisCompleted", e);
        this._emitEnd();
      };
      const onCancel = (_s: any, e: any) => {
        console.warn("[TTS] SynthesisCanceled", e);
        this._emitEnd();
      };
      const onWord = (_s: any, e: any) => {
        try {
          const wb = e as sdk.SpeechSynthesisWordBoundaryEventArgs;
          const token = (wb.text ?? "").toString();
          // Azure returns 100-nanosecond ticks in audioOffset → convert to ms
          const offsetMs =
            typeof (wb as any).audioOffset === "number"
              ? (wb as any).audioOffset / 10000
              : typeof (wb as any).offset === "number"
                ? (wb as any).offset
                : undefined;

          if (token) this._emitWord(token, offsetMs);
        } catch {}
      };

      // Newer typings / event fields
      (synthesizer as any).SynthesisStarted = onStart;
      (synthesizer as any).SynthesisCompleted = onComplete;
      (synthesizer as any).SynthesisCanceled = onCancel;
      (synthesizer as any).WordBoundary = onWord;

      // Older/camelCase variants (no-op if SDK ignores them)
      (synthesizer as any).synthesisStarted = onStart;
      (synthesizer as any).synthesisCompleted = onComplete;
      (synthesizer as any).synthesisCanceled = onCancel;
      (synthesizer as any).wordBoundary = onWord;
    } catch {}

    return { speechConfig, speaker, audioConfig, synthesizer, voice: this.voice, builtAt: Date.now() };
  }

  private _applySpeakerVolume() {
    // SpeakerAudioDestination.volume expects 0..100
    const userVol = this.muted ? 0 : Math.round(this.volume01 * 100);
    const duckedVol = this.ducked ? Math.round(Math.max(Math.min(this.volume01, 0.15), MIN_AUDIBLE) * 100) : userVol;

    const effective = this.muted ? 0 : Math.max(duckedVol, Math.round(MIN_AUDIBLE * 100));

    try {
      if (this.speaker) this.speaker.volume = effective;
    } catch {}
  }

  private async _refreshAuthIfNeeded() {
    if ((Date.now() - this.tokenFetchedAt) <= TOKEN_REFRESH_MS) return;
    const { token } = await this._fetchToken();
    this.authToken = token;
    if (this.speechConfig) this.speechConfig.authorizationToken = token;
  }

  private async _fetchToken(): Promise<{ token: string; region: string }> {
    const res = await fetch(TOKEN_URL, { method: "GET", credentials: "omit" });
    if (!res.ok) throw new Error(`TTS token fetch failed: ${res.status}`);
    return res.json();
  }

  private _pump() {
    if (this.playing || this.paused) return;
    const next = this.queue.shift();
    if (!next) return;

    this.playing = true;

    const run = async () => {
      try {
        await this._refreshAuthIfNeeded();
        try {
          await this._speakOnce(next.text);
        } catch (first) {
          // a pre-connected (warm) pipeline can go stale, or stop() may have torn it down mid-way:
          // rebuild from scratch and try once more before giving up
          console.warn("[TTS] retrying on a fresh pipeline", first);
          this._resetPipeline();
          await this._ensureReady();
          await this._speakOnce(next.text);
        }
        next.resolve();
      } catch (e) {
        console.error("[TTS] could not speak this reply", e);
        // never leave the screen "speaking" forever: the reveal finishes and the text shows in full
        this._emitEnd();
        next.reject(e);
      } finally {
        this.playing = false;
        if (!this.paused) this._pump();
      }
    };

    run();
  }

  /** Throw away the live and the warm pipeline (the next speak builds a fresh one). */
  private _resetPipeline() {
    try { this.speaker?.pause(); } catch {}
    try { this.synthesizer?.close(); } catch {}
    this.synthesizer = null;
    this.audioConfig = null;
    this.speaker = null;
    this.speechConfig = null;
    this._dropSpare();
  }

  /** One synthesis of `input` on the live pipeline; rejects on any failure (never leaves a dangling start). */
  private async _speakOnce(input: string): Promise<void> {
    if (!this.synthesizer) await this._ensureReady();
    {
      {
        await new Promise<void>((resolve, reject) => {
          if (!this.synthesizer) return reject(new Error("TTS pipeline not ready"));

          // Track text for SynthesisStarted callback
          this.currentUtteranceText = input;

          // 🔔 announce start for reveal
          this._emitStart(input);

          const onSuccess = (result: sdk.SpeechSynthesisResult) => {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              return resolve();
            }

            if (result.reason === sdk.ResultReason.Canceled) {
              const details = getSynthesisCancelDetails(result);
              const err = new Error(
                `TTS canceled: reason=${details.reason}; errorCode=${details.errorCode}; ` +
                `details=${details.errorDetails || "n/a"}`
              );
              console.error("[TTS] canceled", {
                reason: details.reason,
                code: details.errorCode,
                details: details.errorDetails,
              });
              return reject(err);
            }

            console.error("[TTS] unexpected result", { reason: result.reason, result });
            reject(new Error(`TTS failed: ${result.reason}`));
          };

          const onError = (err: any) => {
            console.error("[TTS] speak*Async error", err);
            reject(err);
          };

          if (isLikelySsml(input)) {
            // Use SSML verbatim, but sanitize to single-language
            const singleLang = sanitizeSingleLanguageSsml(input);
            this.synthesizer!.speakSsmlAsync(singleLang, onSuccess, onError);
          } else {
            // 🔁 Plain text path to avoid SSML language-validation errors
            this.synthesizer!.speakTextAsync(forSpeech(input), onSuccess, onError);
          }
        });
      }
    }
  }
}

// Singleton accessor
export function getTTS(): TTSPublicAPI {
  return TTSManager.instance;
}
