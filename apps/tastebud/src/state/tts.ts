// apps/tastebud/src/state/tts.ts
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

type QueueItem = { id: string; text: string; resolve: () => void; reject: (e: any) => void };

export type TTSPublicAPI = {
  speak: (text: string) => Promise<void>;
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
};

const TOKEN_URL = import.meta.env.VITE_SPEECH_TOKEN_URL || "/azure/speech-token";
const DEFAULT_VOICE = import.meta.env.VITE_AZURE_SPEECH_VOICE || "bn-IN-BashkarNeural";

const LS_MUTED = "tts.muted";
const LS_VOLUME = "tts.volume"; // 0..1
const LS_VOICE = "tts.voice";

const TOKEN_REFRESH_MS = 9 * 60 * 1000; // refresh a bit before 10m

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
  const v = localStorage.getItem(LS_MUTED);
  return v === "1";
}
function loadVolume(): number {
  const v = localStorage.getItem(LS_VOLUME);
  const n = v ? Number(v) : 1;
  if (Number.isNaN(n)) return 1;
  return Math.min(1, Math.max(0, n));
}
function loadVoice(): string {
  return localStorage.getItem(LS_VOICE) || DEFAULT_VOICE;
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

  private queue: QueueItem[] = [];
  private playing = false;
  private paused = false;

  private muted = loadMuted();
  private volume01 = loadVolume();
  private voice = loadVoice();

  // Ducking state
  private ducked = false;
  private preDuckVolume01: number | null = null;

  private constructor() {}

  // ---------- public API ----------
  getMuted() { return this.muted; }
  getVolume() { return this.volume01; }
  getVoice() { return this.voice; }

  setMuted(muted: boolean) {
    this.muted = !!muted;
    localStorage.setItem(LS_MUTED, this.muted ? "1" : "0");
    if (this.speaker) this._applySpeakerVolume();
  }

  setVolume(vol01: number) {
    const v = Math.min(1, Math.max(0, Number(vol01)));
    this.volume01 = v;
    localStorage.setItem(LS_VOLUME, String(v));
    if (this.speaker) this._applySpeakerVolume();
  }

  setVoice(shortName: string) {
    this.voice = shortName || DEFAULT_VOICE;
    localStorage.setItem(LS_VOICE, this.voice);
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
    // If already ducked, ignore
    if (this.ducked) return;
    this.ducked = true;

    // Snapshot current volume and lower to ~15%
    if (this.preDuckVolume01 === null) this.preDuckVolume01 = this.volume01;
    const target = Math.min(this.volume01, 0.15);
    if (!this.muted) {
      // Only change the live output; do not overwrite user preference in LS
      try {
        if (this.speaker) this.speaker.volume = Math.round(target * 100);
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
        if (this.speaker) this.speaker.volume = Math.round(restore * 100);
      } catch {}
    }
  }
  // ↑↑↑ Ducking API

  // ---------- internals ----------
  private async _ensureReady() {
    // Token valid?
    if (!this.authToken || (Date.now() - this.tokenFetchedAt) > TOKEN_REFRESH_MS) {
      const { token, region } = await this._fetchToken();
      this.authToken = token;
      this.region = region;
      this.tokenFetchedAt = Date.now();
    }

    // Already initialized?
    if (this.synthesizer) return;

    this.speechConfig = sdk.SpeechConfig.fromAuthorizationToken(this.authToken, this.region);

    // Voice + explicit language to match the voice locale (prevents multi-language SSML)
    this.speechConfig.speechSynthesisVoiceName = this.voice;
    this.speechConfig.speechSynthesisLanguage = localeFromVoice(this.voice);

    // Create a speaker we can control volume on
    this.speaker = new sdk.SpeakerAudioDestination();
    this.audioConfig = sdk.AudioConfig.fromSpeakerOutput(this.speaker);
    this._applySpeakerVolume();

    this.synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, this.audioConfig);

    // ✅ SDK 1.46.x uses PascalCase event names
    try {
      // These handlers are optional but super helpful while diagnosing cancels
      (this.synthesizer as any).SynthesisStarted = (_s: any, e: any) => console.debug("[TTS] SynthesisStarted", e);
      (this.synthesizer as any).SynthesisCompleted = (_s: any, e: any) => console.debug("[TTS] SynthesisCompleted", e);
      (this.synthesizer as any).SynthesisCanceled = (_s: any, e: any) => console.warn("[TTS] SynthesisCanceled", e);
    } catch {}
  }

  private _applySpeakerVolume() {
    // SpeakerAudioDestination.volume expects 0..100
    const volPercent = this.muted ? 0 : Math.round(this.volume01 * 100);

    // If currently ducked, apply ducked volume, not the full one
    const effective = this.ducked ? Math.min(volPercent, Math.round(0.15 * 100)) : volPercent;

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

        await new Promise<void>((resolve, reject) => {
          const input = next.text;
          const voice = this.voice || DEFAULT_VOICE;

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
            this.synthesizer!.speakTextAsync(input, onSuccess, onError);
          }
        });

        next.resolve();
      } catch (e) {
        next.reject(e);
      } finally {
        this.playing = false;
        if (!this.paused) this._pump();
      }
    };

    run();
  }
}

// Singleton accessor
export function getTTS(): TTSPublicAPI {
  return TTSManager.instance;
}
