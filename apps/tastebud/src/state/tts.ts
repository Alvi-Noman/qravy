// apps/tastebud/src/state/tts.ts
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { speechPlan, wordToShow, type SpeechPlan } from "./speechWords";

type QueueItem = { id: string; text: string; aside?: boolean; resolve: () => void; reject: (e: any) => void };

export type TtsEvents = {
  onStart?: (originalText: string) => void;
  onWord?: (word: string, offsetMs?: number) => void;   // ⬅️ now includes audio offset
  onEnd?: () => void;                                    // synthesis done (or stopped) — the audio may STILL be playing
  /** The guest has finished HEARING it: played to the end, stopped, or failed. (Azure's "synthesis completed" comes
   *  seconds earlier, while the speaker is still playing — opening the mic then cut the waiter off.) */
  onPlaybackEnd?: () => void;
  /** The sound really started coming out of the speaker. Word events (onWord) arrive while the audio is still being
   *  generated — ahead of what the guest hears — so a word's time is this moment + its offset. */
  onPlaybackStart?: () => void;
};

export type TTSPublicAPI = {
  /** `aside`: the waiter's opening line while it looks something up ("let me check…") — spoken, but no events
   *  (the screen's reveal and the mic ignore it); resolves once it has been HEARD, so what's spoken next follows it. */
  speak: (text: string, opts?: { aside?: boolean }) => Promise<void>;
  /** Call INSIDE a tap ("Get started", holding the orb): unlocks sound on iPhones (see sharedAudio below). */
  unlock: () => void;
  /** Get a connected speech pipeline ready in the background (call while the waiter is thinking). */
  warm: () => void;
  /** Fetch the speech token ahead of time (safe before any tap — no audio is set up). */
  prefetch: () => void;
  stop: () => void;
  /** The guest cut in: the voice fades out quickly (then stops, like stop()). Already silent → stop() at once. */
  fadeOut: (ms?: number) => void;
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

// ---------- iPhone (every iPhone browser — Safari, Chrome, …: all are WebKit): why the waiter was silent ----------
// iPhones have no MediaSource, so the Speech SDK's SpeakerAudioDestination takes its fallback path: it collects the
// whole reply and plays it only when the speaker is CLOSED — which happens when the synthesizer is disposed, never at
// the end of a reply (the pipeline is kept for the next one). So the audio was made and never played. And when it
// does call play(), that's long after the guest's tap, on a brand-new <audio> — which iOS refuses anyway.
// The fix, on iPhones only: no SDK speaker. Each reply is synthesized to memory (the words' timings still arrive) and
// played on ONE <audio> that the guest's tap unlocked (unlockAudioOutput); its playing / ended events drive the
// reveal and the mic, like the SDK's onAudioStart / onAudioEnd do elsewhere. (Desktop, Android: the SDK, untouched.)
const NEEDS_SHARED_AUDIO = typeof window !== "undefined" && typeof (window as any).MediaSource === "undefined";
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
let sharedAudio: HTMLAudioElement | null = null;

function sharedAudioEl(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
    (sharedAudio as any).playsInline = true;
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

function unlockAudioOutput(): void {
  if (!NEEDS_SHARED_AUDIO) return;
  try {
    const el = sharedAudioEl();
    if (!el.paused) return; // already playing the waiter — it's unlocked
    el.src = SILENT_WAV;
    el.play()?.catch(() => {});
  } catch {
    /* no audio element here */
  }
}

/** The iPhone speaker: plays a finished reply (MP3 bytes) on the tap-unlocked <audio>. Same shape as the parts of
 *  SpeakerAudioDestination this file uses (pause / resume / close / volume / onAudioStart / onAudioEnd). */
class SharedAudioSpeaker {
  onAudioStart: ((s: any) => void) | null = null;
  onAudioEnd: ((s: any) => void) | null = null;
  private url: string | null = null;
  private closed = false;
  private mine = false; // the shared <audio> is playing THIS speaker's reply

  set volume(v: number) {
    try { sharedAudioEl().volume = Math.max(0, Math.min(1, v / 100)); } catch {}
  }
  get volume() {
    return Math.round((sharedAudio?.volume ?? 1) * 100);
  }

  play(mp3: ArrayBuffer) {
    if (this.closed || !mp3?.byteLength) {
      this.onAudioEnd?.(this);
      return;
    }
    const el = sharedAudioEl();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(new Blob([mp3], { type: "audio/mpeg" }));
    this.mine = true;
    el.onplaying = () => {
      el.onplaying = null;
      if (this.mine) this.onAudioStart?.(this);
    };
    el.onended = () => this.finish();
    el.src = this.url;
    el.play()?.catch((e) => {
      console.warn("[TTS] playback was blocked by the browser", e);
      this.finish();
    });
  }

  private finish() {
    if (!this.mine) return;
    this.mine = false;
    this.onAudioEnd?.(this);
  }

  pause() {
    if (this.mine) {
      try { sharedAudio?.pause(); } catch {}
    }
  }
  resume() {
    if (this.mine) sharedAudio?.play()?.catch(() => {});
  }
  close() {
    this.closed = true;
    if (this.mine) {
      this.mine = false;
      try { sharedAudio?.pause(); } catch {}
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
const DEFAULT_VOICE = import.meta.env.VITE_AZURE_SPEECH_VOICE || "bn-BD-PradeepNeural";

// ---------- saved voice for short lines that come back ("please say that again", the welcome) ----------
// A short line the voice has said once is kept (its MP3 + its words' timings) and played straight from here the next
// time the very same words are said in the same voice — no wait for the speech service. Exactly the same audio the
// service made, so nothing the guest hears changes. Kept in this browser only (a few, newest first), across visits.
type Clip = { audio: ArrayBuffer; words: Array<[string, number | undefined, number | undefined]>; durMs: number };
// a saved line playing now: `done` tells the queue it's over (heard to the end, stopped, or its safety timer)
type Replay = { el: HTMLAudioElement; url: string; done: () => void; onEnded?: () => void };
const CLIP_MAX_CHARS = 160; // (longer replies are nearly always new words — not worth keeping)
const CLIP_MAX = 12;
const LS_CLIPS = "tts.clips.v1";
const clips = new Map<string, Clip>(); // (insertion order = least recently used first)
let clipsLoaded = false;

function b64FromBuf(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bufFromB64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
function loadClips() {
  if (clipsLoaded) return;
  clipsLoaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CLIPS) || "[]");
    if (!Array.isArray(raw)) return;
    for (const c of raw) {
      if (c && typeof c.k === "string" && typeof c.a === "string" && Array.isArray(c.w)) {
        clips.set(c.k, { audio: bufFromB64(c.a), words: c.w, durMs: Number(c.d) || 0 });
      }
    }
  } catch { /* nothing saved, or storage blocked */ }
}
function saveClips() {
  try {
    const out = [...clips.entries()].map(([k, c]) => ({ k, a: b64FromBuf(c.audio), w: c.words, d: c.durMs }));
    localStorage.setItem(LS_CLIPS, JSON.stringify(out));
  } catch { /* full or blocked: they stay for this visit only */ }
}
function clipKey(voice: string, spoken: string) {
  return `${voice}|${spoken}`;
}
function getClip(key: string): Clip | null {
  loadClips();
  const c = clips.get(key);
  if (!c) return null;
  clips.delete(key);
  clips.set(key, c); // most recently used
  return c;
}
function putClip(key: string, clip: Clip) {
  loadClips();
  clips.delete(key);
  clips.set(key, clip);
  while (clips.size > CLIP_MAX) clips.delete(clips.keys().next().value as string);
  saveClips();
}

const LS_MUTED = "tts.muted";
const LS_VOLUME = "tts.volume"; // 0..1
const LS_VOICE = "tts.voice";

const TOKEN_FALLBACK_LIFE_MS = 4 * 60 * 1000; // no expiry from the server → assume only 4 min left (it may be reused)
const MIN_AUDIBLE = 0.05;               // never let live output go below 5% if not muted
const SPARE_MAX_AGE_MS = 4 * 60 * 1000; // a pre-connected pipeline older than this is rebuilt

type Pipeline = {
  speechConfig: sdk.SpeechConfig;
  speaker: sdk.SpeakerAudioDestination | SharedAudioSpeaker;
  audioConfig: sdk.AudioConfig | null; // null on iPhones: the reply is synthesized to memory (SharedAudioSpeaker)
  synthesizer: sdk.SpeechSynthesizer;
  voice: string;
  builtAt: number;
};

/* ---------- Bangla pronunciation fixes: utils in ./speechWords (built-ins + what restaurants / Qravy taught) ---------- */
export { setPronunciations } from "./speechWords";

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
  // when the token really stops working (from the server — it may have been issued minutes before we got it)
  private tokenExpiresAt = 0;

  private speechConfig: sdk.SpeechConfig | null = null;
  private speaker: sdk.SpeakerAudioDestination | SharedAudioSpeaker | null = null;
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

  // a saved line playing on the shared <audio> (see Clip), and the words of the line being synthesized now (kept
  // with its audio when it is short)
  private replay: Replay | null = null;
  private capturing: Clip["words"] | null = null;
  // an aside (see speak) being said: its events go nowhere, and `done` lets the queue go on once it's been heard
  private aside: { done: () => void } | null = null;

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

  unlock = () => unlockAudioOutput();

  async speak(text: string, opts?: { aside?: boolean }): Promise<void> {
    const clean = (text ?? "").trim();
    if (!clean) return;

    // a saved line plays without the speech service — no token / connection to wait for
    if (!this._savedClip(clean)) await this._ensureReady();

    return new Promise<void>((resolve, reject) => {
      const item: QueueItem = { id: crypto.randomUUID(), text: clean, aside: !!opts?.aside, resolve, reject };
      this.queue.push(item);
      this._pump();
    });
  }

  prefetch = () => {
    // the token is the slow first step of the first reply — get it while the guest is still looking at the screen
    this._ensureToken().catch((e) => console.debug("[TTS] token prefetch skipped", e));
  };

  warm = () => {
    this._warm().catch((e) => console.debug("[TTS] warm-up skipped", e));
  };

  // a fade in progress (the guest cut in)
  private fading: ReturnType<typeof setInterval> | null = null;

  fadeOut(ms = 200) {
    if (this.fading) return; // already fading
    if (this.replay) return this.stop(); // (a saved line: short — it just stops)
    const sp = this.speaker;
    let from = 0;
    try {
      from = sp ? Number(sp.volume) || 0 : 0;
    } catch {
      from = 0;
    }
    // nothing audible to fade (or no speaker) → stop now
    if (!sp || from <= 0) return this.stop();
    // nothing more after this sentence
    const q = this.queue.splice(0);
    q.forEach((it) => it.reject(new Error("stopped")));
    // Azure's speaker takes 0..1, the iPhone one (SharedAudioSpeaker) 0..100
    const scale = from > 1 ? 100 : 1;
    const steps = 8;
    const at = (i: number) => {
      const v = from * Math.max(0, 1 - i / steps);
      return scale === 100 ? Math.round(v) : v;
    };
    // iPhones ignore an <audio> element's volume: fading there would only delay the stop
    try {
      sp.volume = at(1);
      if (Math.abs(Number(sp.volume) - from) < from * 0.05) return this.stop();
    } catch {
      return this.stop();
    }
    let i = 1;
    this.fading = setInterval(() => {
      i += 1;
      try {
        sp.volume = at(i);
      } catch {}
      if (i >= steps) this.stop();
    }, Math.max(10, Math.round(ms / steps)));
  }

  stop() {
    if (this.fading) {
      clearInterval(this.fading);
      this.fading = null;
    }
    // Cancel current + future items
    this.paused = false;
    const q = this.queue.splice(0);
    q.forEach((it) => it.reject(new Error("stopped")));

    this._endReplay();
    this.capturing = null;
    // Pause speaker (halts playback), then close synthesizer to fully stop
    try { this.speaker?.pause(); } catch {}
    try { this.synthesizer?.close(); } catch {}
    // Drop current audio pipeline so next speak() re-initializes cleanly
    this.synthesizer = null;
    this.audioConfig = null;
    this.speaker = null;
    this.speechConfig = null;

    this.playing = false;

    // Notify listeners that playback ended (an aside's end goes to the queue, never to them)
    this._emitEnd();
    this._emitPlaybackEnd();
    this.aside?.done();
  }

  pause() {
    try { this.speaker?.pause(); } catch {}
    try { this.replay?.el.pause(); } catch {}
    this.paused = true;
    this.playing = false;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    try { this.speaker?.resume(); } catch {}
    try { this.replay?.el.play()?.catch(() => {}); } catch {}
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
    if (this.aside) return;
    this.listeners.forEach(h => { h.onStart?.(text); });
  }
  // the utterance being spoken: which stretches of its text stand for a different written word (speechWords)
  private plan: SpeechPlan | null = null;

  private _emitWord(word: string, offsetMs?: number, textOffset?: number) {
    if (!word) return;
    this.capturing?.push([word, offsetMs, textOffset]); // (kept with the line's audio — see Clip)
    // the speech engine reports SSML-escaped text ("&amp;") — show what was actually said
    const shown = word
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    // a learned word said as several ("ষোলআনা" → "শোলো আনা") shows once, as written; its other spoken words show nothing
    const word2 = wordToShow(this.plan, shown, textOffset);
    if (!word2 || this.aside) return;
    this.listeners.forEach(h => { h.onWord?.(word2, offsetMs); });
  }
  private _emitEnd() {
    if (this.aside) return;
    this.listeners.forEach(h => { h.onEnd?.(); });
  }

  // playback end: once per utterance, from the speaker's own "audio ended" — or a safety timer from the audio's
  // length, or stop / failure (so a listener waiting for it is never stuck)
  private playbackPending = false;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private _emitPlaybackEnd() {
    if (!this.playbackPending) return;
    this.playbackPending = false;
    if (this.playbackTimer) { clearTimeout(this.playbackTimer); this.playbackTimer = null; }
    // (an aside heard to the end: the queue goes on — the listeners never heard it start)
    if (this.aside) return this.aside.done();
    this.listeners.forEach(h => { h.onPlaybackEnd?.(); });
  }

  /** Still good for at least another minute? (by its real expiry — not by when WE happened to fetch it) */
  private _tokenFresh(): boolean {
    return !!this.authToken && Date.now() < this.tokenExpiresAt - 60_000;
  }

  private async _ensureToken(fresh = false) {
    if (!fresh && this._tokenFresh()) return;
    const { token, region, expiresAt } = await this._fetchToken(fresh);
    this.authToken = token;
    this.region = region;
    this.tokenFetchedAt = Date.now();
    // (an older gateway sends no expiry: assume the worst case it could have reused it for)
    this.tokenExpiresAt = typeof expiresAt === "number" && expiresAt > 0 ? expiresAt : Date.now() + TOKEN_FALLBACK_LIFE_MS;
    if (this.speechConfig) this.speechConfig.authorizationToken = token;
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
    const speaker: sdk.SpeakerAudioDestination | SharedAudioSpeaker = NEEDS_SHARED_AUDIO
      ? new SharedAudioSpeaker()
      : new sdk.SpeakerAudioDestination();
    // the moment the guest has HEARD it all (not when synthesis finished — that's seconds earlier)
    (speaker as any).onAudioEnd = () => {
      if (this.speaker === speaker) this._emitPlaybackEnd();
    };
    // …and the moment the guest STARTS hearing it (the words' clock: shown text follows the voice, not the synthesis)
    (speaker as any).onAudioStart = () => {
      if (this.speaker === speaker && !this.aside) this.listeners.forEach((h) => { h.onPlaybackStart?.(); });
    };
    const audioConfig = speaker instanceof SharedAudioSpeaker ? null : sdk.AudioConfig.fromSpeakerOutput(speaker);

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig as any);

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

          // where the word is in the text the voice was given (to map a learned respelling back to its written word)
          const textOffset = typeof (wb as any).textOffset === "number" ? (wb as any).textOffset : undefined;
          if (token) this._emitWord(token, offsetMs, textOffset);
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
    try {
      if (this.replay) this.replay.el.volume = effective / 100; // (an <audio> takes 0..1)
    } catch {}
  }

  /** A saved copy of exactly this line in this voice (see Clip), or null. */
  private _savedClip(input: string): Clip | null {
    if (isLikelySsml(input)) return null;
    const spoken = speechPlan(input).spoken;
    if (spoken.length > CLIP_MAX_CHARS) return null;
    return getClip(clipKey(this.voice, spoken));
  }

  /** Stop a saved line that is playing (no events — the caller says what happened). */
  private _endReplay() {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    // (only this line's own handler and sound — the iPhone voice uses the same <audio> after it)
    if (r.onEnded && r.el.onended === r.onEnded) r.el.onended = null;
    try { if (r.el.src === r.url) r.el.pause(); } catch {}
    URL.revokeObjectURL(r.url);
    r.done();
  }

  /** Play a saved line: true once its sound is coming out; false (nothing announced) when there is no saved copy or
   *  the browser won't play it — then the speech service says it as usual. */
  private async _playSaved(input: string, finished: () => void): Promise<boolean> {
    const clip = this._savedClip(input);
    if (!clip) return false;
    const plan = speechPlan(input);
    this._endReplay();
    const el = sharedAudioEl();
    const url = URL.createObjectURL(new Blob([clip.audio], { type: "audio/mpeg" }));
    let told = false;
    const me: Replay = { el, url, done: () => { if (!told) { told = true; finished(); } } };
    me.onEnded = () => {
      if (this.replay !== me) return;
      this._endReplay();
      this._emitPlaybackEnd();
    };
    this.replay = me;
    el.onplaying = null;
    el.onended = me.onEnded;
    el.src = url;
    this._applySpeakerVolume();
    try {
      await el.play();
    } catch (e) {
      console.debug("[TTS] saved line could not play here → the speech service says it", e);
      told = true; // (not finished: it never started — the caller speaks it the usual way)
      if (this.replay === me) this._endReplay();
      return false;
    }
    if (this.replay !== me) return true; // (stopped already — stop() has said so)
    // the same events, in the same order, as a line from the speech service: start → words → sound → (synthesis
    // done) → heard to the end
    this.currentUtteranceText = input;
    this.plan = plan;
    this.playbackPending = true;
    if (this.playbackTimer) { clearTimeout(this.playbackTimer); this.playbackTimer = null; }
    this._emitStart(input);
    this.capturing = null;
    for (const [w, off, tOff] of clip.words) this._emitWord(w, off, tOff);
    if (!this.aside) this.listeners.forEach((h) => { h.onPlaybackStart?.(); });
    this._emitEnd();
    // safety net: the audio's own length + a margin, like a line from the service
    this.playbackTimer = setTimeout(() => {
      if (this.replay === me) this._endReplay();
      this._emitPlaybackEnd();
    }, (clip.durMs || 8000) + 3000);
    return true;
  }

  private async _refreshAuthIfNeeded() {
    await this._ensureToken();
  }

  private async _fetchToken(fresh = false): Promise<{ token: string; region: string; expiresAt?: number }> {
    // never from the browser's cache — a cached response once handed back an already-expired token
    const url = fresh ? `${TOKEN_URL}${TOKEN_URL.includes("?") ? "&" : "?"}fresh=1` : TOKEN_URL;
    const res = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`TTS token fetch failed: ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (ct && !ct.includes("application/json")) {
      throw new Error(`TTS token fetch failed: expected JSON from ${url} but got ${ct}`);
    }
    return res.json();
  }

  private _pump() {
    if (this.playing || this.paused) return;
    const next = this.queue.shift();
    if (!next) return;

    this.playing = true;

    if (next.aside) {
      void this._runAside(next);
      return;
    }

    const run = async () => {
      try {
        // said before, in this voice → the saved sound, at once (the next line waits until it has been heard)
        let heard: () => void = () => {};
        const over = new Promise<void>((r) => { heard = r; });
        if (await this._playSaved(next.text, () => heard())) {
          await over;
          next.resolve();
          return;
        }
        await this._refreshAuthIfNeeded();
        try {
          await this._speakOnce(next.text);
        } catch (first) {
          // a pre-connected (warm) pipeline can go stale, or stop() may have torn it down mid-way:
          // rebuild from scratch and try once more before giving up
          // …with a brand-new token: an expired one is the usual reason, and retrying with it failed every reply
          // until a page reload
          console.warn("[TTS] retrying on a fresh pipeline with a new token", first);
          this._resetPipeline();
          await this._ensureToken(true);
          await this._ensureReady();
          await this._speakOnce(next.text);
        }
        next.resolve();
      } catch (e) {
        console.error("[TTS] could not speak this reply", e);
        // never leave the screen "speaking" forever: the reveal finishes and the text shows in full
        this._emitEnd();
        this._emitPlaybackEnd();
        next.reject(e);
      } finally {
        this.playing = false;
        if (!this.paused) this._pump();
      }
    };

    run();
  }

  /** An aside (see speak): said like any line, but quietly — and the queue waits until it has been heard. */
  private async _runAside(next: QueueItem) {
    let heard: () => void = () => {};
    const over = new Promise<void>((r) => { heard = r; });
    let told = false;
    this.aside = { done: () => { if (told) return; told = true; this.aside = null; heard(); } };
    const me = this.aside;
    try {
      if (!(await this._playSaved(next.text, () => me.done()))) {
        await this._refreshAuthIfNeeded();
        await this._speakOnce(next.text);
      }
      await over;
      next.resolve();
    } catch (e) {
      console.debug("[TTS] the opening line could not be said", e);
      me.done();
      next.reject(e);
    } finally {
      this.playing = false;
      if (!this.paused) this._pump();
    }
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

          // a new utterance is playing — its playback end is still to come
          this.playbackPending = true;
          if (this.playbackTimer) { clearTimeout(this.playbackTimer); this.playbackTimer = null; }
          const startedAt = Date.now();
          let clipAs = ""; // (the saved-line key when this line is short enough to keep)

          // 🔔 announce start for reveal
          this._emitStart(input);

          const onSuccess = (result: sdk.SpeechSynthesisResult) => {
            const words = this.capturing;
            this.capturing = null;
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              // safety net: if the speaker never reports "ended", the audio's own length (100-ns ticks) + a margin
              const durMs = typeof (result as any).audioDuration === "number" ? (result as any).audioDuration / 10000 : 0;
              // a short line: kept, so the next time these words come back they play at once (see Clip)
              const audio = (result as any).audioData as ArrayBuffer | undefined;
              if (words && clipAs && audio && audio.byteLength > 0) {
                try {
                  putClip(clipAs, { audio: audio.slice(0), words, durMs });
                } catch {}
              }
              // iPhones: the whole reply is here now — play it on the tap-unlocked <audio>. It starts NOW (not at the
              // synthesis start), so the safety net counts from now.
              const shared = this.speaker instanceof SharedAudioSpeaker ? this.speaker : null;
              if (shared) shared.play(result.audioData);
              const left = shared ? durMs + 3000 : Math.max(1500, startedAt + durMs + 1500 - Date.now());
              if (this.playbackTimer) clearTimeout(this.playbackTimer);
              this.playbackTimer = setTimeout(() => this._emitPlaybackEnd(), left);
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
            this.capturing = null;
            console.error("[TTS] speak*Async error", err);
            reject(err);
          };

          if (isLikelySsml(input)) {
            // Use SSML verbatim, but sanitize to single-language
            this.plan = null;
            this.capturing = null;
            const singleLang = sanitizeSingleLanguageSsml(input);
            this.synthesizer!.speakSsmlAsync(singleLang, onSuccess, onError);
          } else {
            // 🔁 Plain text path to avoid SSML language-validation errors
            const plan = speechPlan(input);
            this.plan = plan;
            clipAs = plan.spoken.length <= CLIP_MAX_CHARS ? clipKey(this.voice, plan.spoken) : "";
            this.capturing = clipAs ? [] : null;
            this.synthesizer!.speakTextAsync(plan.spoken, onSuccess, onError);
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
