// apps/tastebud/src/pages/MicTest.tsx
// TEMPORARY test page (<restaurant>.qravy.com/mic-test, /t/<sub>/mic-test — linked from nowhere): the same words
// recorded with the phone's noise suppression ON (what the waiter uses now) and OFF (raw), and what the waiter's
// speech-to-text heard for each — to see which one survives a noisy room. Nothing is saved.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

const CART_API_BASE =
  (typeof window !== 'undefined' && (window as any).__STORE__?.cartApiBase) ||
  (import.meta.env.DEV ? 'http://localhost:7081' : '/cart-api');
const RATE = 16000;
const MAX_MS = 20_000;

type Kind = 'clean' | 'raw';
type Heard = { label: string; text: string; ms: number; error?: string };
type Clip = { kind: Kind | 'file'; url: string; settings: string; heard: Heard[] };
type Try = { id: number; at: string; said: string; clips: Clip[]; note?: string };

const CONSTRAINTS: Record<Kind, MediaTrackConstraints> = {
  clean: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  raw: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

function wavUrl(pcm: Int16Array): string {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function join(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function settingsOf(stream: MediaStream): { text: string; ns: boolean | undefined } {
  const s = (stream.getAudioTracks()[0]?.getSettings?.() || {}) as MediaTrackSettings;
  const on = (x: unknown) => (x === true ? 'on' : x === false ? 'off' : '?');
  return {
    text: `noise suppression ${on(s.noiseSuppression)} · auto volume ${on(s.autoGainControl)} · echo cancel ${on(s.echoCancellation)}`,
    ns: typeof s.noiseSuppression === 'boolean' ? s.noiseSuppression : undefined,
  };
}

type Engine = 'openai' | 'gemini' | 'elevenlabs';

// every engine on one clip: the waiter's own (gpt-4o + the menu hint) first
const ENGINES: [string, boolean, Engine][] = [
  ['gpt-4o + menu hint (the waiter now)', true, 'openai'],
  ['gpt-4o, no hint', false, 'openai'],
  ['Gemini 2.5 Flash + menu', true, 'gemini'],
  ['ElevenLabs Scribe v2 + dish names', true, 'elevenlabs'],
];

async function allEngines(pcm: Int16Array, tenant: string): Promise<Heard[]> {
  return Promise.all(ENGINES.map(async ([label, hint, engine]) => ({ label, ...(await transcribe(pcm, tenant, hint, engine)) })));
}

/** Any audio file (the ▶ Listen MP3 from Cortex / the admin panel, a phone recording) → 16 kHz mono PCM, ≤ MAX_MS. */
async function fileToPcm(file: File): Promise<{ pcm: Int16Array; seconds: number; cut: boolean }> {
  const ac = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(await file.arrayBuffer());
  } finally {
    ac.close().catch(() => {});
  }
  const seconds = Math.min(decoded.duration, MAX_MS / 1000);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const f32 = (await off.startRendering()).getChannelData(0);
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) pcm[i] = (Math.max(-1, Math.min(1, f32[i])) * 0x7fff) | 0;
  return { pcm, seconds, cut: decoded.duration > MAX_MS / 1000 };
}

async function transcribe(pcm: Int16Array, tenant: string, hint: boolean, engine: Engine = 'openai'): Promise<{ text: string; ms: number; error?: string }> {
  try {
    const r = await fetch(`${CART_API_BASE}/stt-test?tenant=${encodeURIComponent(tenant)}&rate=${RATE}&hint=${hint ? 1 : 0}&engine=${engine}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(pcm.buffer.slice(0) as ArrayBuffer),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { text: '', ms: 0, error: j.error || `error ${r.status}` };
    return { text: (j.text || '(nothing heard)') + (j.echo ? '  ⚠ copied the menu hint — it heard no clear speech' : ''), ms: j.ms || 0 };
  } catch (e: any) {
    return { text: '', ms: 0, error: String(e?.message || e) };
  }
}

export default function MicTest() {
  const params = useParams();
  const tenant = params.subdomain || (typeof window !== 'undefined' && (window as any).__STORE__?.subdomain) || '';
  const [mode, setMode] = useState<'both' | 'one'>('both');
  const [said, setSaid] = useState('');
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [step, setStep] = useState<Kind | null>(null); // "one after the other": which one is being recorded
  const [tries, setTries] = useState<Try[]>([]);
  const [warn, setWarn] = useState('');
  const rec = useRef<{ ctx: AudioContext; streams: Partial<Record<Kind, MediaStream>>; chunks: Record<Kind, Int16Array[]>;
    settings: Partial<Record<Kind, string>>; timer: number } | null>(null);
  const pendingOne = useRef<Clip | null>(null); // the cleaned clip, waiting for its raw twin
  const idRef = useRef(0);

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    const r = rec.current;
    if (!r) return;
    window.clearTimeout(r.timer);
    Object.values(r.streams).forEach((s) => s?.getTracks().forEach((t) => t.stop()));
    r.ctx.close().catch(() => {});
    rec.current = null;
  }

  async function start(kinds: Kind[]) {
    setWarn('');
    const streams: Partial<Record<Kind, MediaStream>> = {};
    let ctx: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no mic API on this page'), { name: 'NoMediaDevices' });
      // both straight from the tap, before anything is awaited: the audio engine (an iPhone keeps one made later
      // silent) and then the mic (some phones refuse it once something else was awaited)
      ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      void ctx.resume().catch(() => {});
      for (const k of kinds) streams[k] = await navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS[k] });
      await ctx.audioWorklet.addModule('/worklets/audio-capture.worklet.js');
      const settings: Partial<Record<Kind, string>> = {};
      const chunks: Record<Kind, Int16Array[]> = { clean: [], raw: [] };
      const ns: Partial<Record<Kind, boolean | undefined>> = {};
      for (const k of kinds) {
        const st = streams[k] as MediaStream;
        const s = settingsOf(st);
        settings[k] = s.text;
        ns[k] = s.ns;
        const src = ctx.createMediaStreamSource(st);
        const node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
        node.port.onmessage = (ev) => {
          if (ev.data?.type === 'chunk' && ev.data.samples) chunks[k].push(new Int16Array(ev.data.samples));
        };
        src.connect(node);
      }
      if (kinds.length === 2 && ns.clean !== undefined && ns.clean === ns.raw) {
        setWarn(
          'এই ফোন একসাথে দুইভাবে মাইক খুলতে পারছে না — দুটো রেকর্ডিং একই রকম হবে। উপরে "একটার পর একটা" বেছে নিন। ' +
            "(This phone can't open the mic two ways at once — pick “one after the other”.)",
        );
      }
      if (ctx.state === 'suspended') await ctx.resume();
      const timer = window.setTimeout(() => void stop(), MAX_MS);
      rec.current = { ctx, streams, chunks, settings, timer };
      setState('recording');
    } catch (e: any) {
      Object.values(streams).forEach((st) => st?.getTracks().forEach((t) => t.stop()));
      ctx?.close().catch(() => {});
      stopAll();
      setState('idle');
      const name = String(e?.name || '');
      const why =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'ব্রাউজার মাইকের অনুমতি দেয়নি। Chrome/Safari-তে খুলুন (Messenger/WhatsApp-এর ভিতরে নয়), ঠিকানার পাশের আইকন → Permissions → Microphone → Allow, তারপর রিলোড করুন।'
          : name === 'NotFoundError'
            ? 'কোনো মাইক পাওয়া যায়নি।'
            : name === 'NotReadableError'
              ? 'মাইক অন্য কোনো অ্যাপ ব্যবহার করছে — সেটা বন্ধ করে আবার চেষ্টা করুন।'
              : '';
      setWarn(`মাইক খোলা যায়নি (${name || 'error'}: ${e?.message || e}). ${why}`);
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    // the last word is still on its way from the mic
    await new Promise((res) => window.setTimeout(res, 350));
    const kinds = (Object.keys(r.streams) as Kind[]).filter((k) => r.streams[k]);
    const pcm: Partial<Record<Kind, Int16Array>> = {};
    kinds.forEach((k) => (pcm[k] = join(r.chunks[k])));
    const settings = r.settings;
    stopAll();
    setState('working');
    const clips: Clip[] = await Promise.all(
      kinds.map(async (k) => {
        const p = pcm[k] as Int16Array;
        if (p.length < RATE * 0.3) {
          // (iPhones end the first mic when a second one opens)
          return { kind: k, url: wavUrl(p), settings: settings[k] || '',
                   heard: [{ label: '', text: '', ms: 0, error: 'no audio — this phone allows one mic at a time: use “one after the other”' }] };
        }
        // the RAW clip (what the waiter records now) through every engine; the cleaned one through the waiter's only
        const heard = k === 'clean'
          ? [{ label: 'gpt-4o + menu hint', ...(await transcribe(p, tenant, true)) }]
          : await allEngines(p, tenant);
        return { kind: k, url: wavUrl(p), settings: settings[k] || '', heard };
      }),
    );
    if (mode === 'one' && kinds.length === 1 && kinds[0] === 'clean') {
      pendingOne.current = clips[0];
      setStep('raw');
      setState('idle');
      return;
    }
    const all = mode === 'one' && pendingOne.current ? [pendingOne.current, ...clips] : clips;
    pendingOne.current = null;
    setStep(null);
    idRef.current += 1;
    setTries((t) => [
      { id: idRef.current, at: new Date().toLocaleTimeString(), said, clips: all,
        note: mode === 'one' ? 'one after the other — the two recordings are two separate takes' : undefined },
      ...t,
    ]);
    setState('idle');
  }

  // "Upload a recording": a clip from before (e.g. a turn the waiter got wrong) through every engine
  async function onFile(file: File) {
    setWarn('');
    setState('working');
    try {
      const { pcm, seconds, cut } = await fileToPcm(file);
      const heard = await allEngines(pcm, tenant);
      idRef.current += 1;
      setTries((t) => [
        { id: idRef.current, at: new Date().toLocaleTimeString(), said,
          clips: [{ kind: 'file', url: URL.createObjectURL(file), heard,
                    settings: `${file.name} · ${seconds.toFixed(1)} s${cut ? ' (the first 20 s)' : ''}` }] },
        ...t,
      ]);
    } catch (e: any) {
      setWarn(`এই ফাইলটা পড়া গেল না (${e?.message || e}). MP3, WAV, M4A বা OGG দিন।`);
    }
    setState('idle');
  }

  const onButton = () => {
    if (state === 'recording') return void stop();
    if (state !== 'idle') return;
    if (mode === 'both') return void start(['clean', 'raw']);
    return void start([step === 'raw' ? 'raw' : 'clean']);
  };

  const label =
    state === 'recording' ? '■ থামান (Stop)' : state === 'working' ? 'শুনছি… (Transcribing…)'
      : mode === 'one' ? (step === 'raw' ? '● ২/২: একই কথা আবার বলুন — RAW' : '● ১/২: বলুন — CLEANED') : '● রেকর্ড (Record)';

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f5', color: '#1b1b1b', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 60px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Mic test</h1>
        <p style={{ fontSize: 14, color: '#555', margin: '0 0 16px' }}>
          একই কথা দুইভাবে রেকর্ড হয় — ফোনের নয়েজ সাপ্রেশন চালু আর বন্ধ (raw — waiter এখন এটাই ব্যবহার করে)। RAW রেকর্ডিং আর আপলোড করা
          রেকর্ডিং সব ইঞ্জিনে যায় — এখনকার gpt-4o, Gemini আর ElevenLabs — পাশাপাশি দেখুন কোনটা ঠিক শুনেছে।
          Nothing is saved. {tenant ? `Menu hint: ${tenant}` : 'No restaurant in the link — no menu hint.'}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['both', 'one'] as const).map((m) => (
            <button key={m} disabled={state !== 'idle'}
              onClick={() => { setMode(m); setStep(null); pendingOne.current = null; setWarn(''); }}
              style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #ccc', fontSize: 14,
                background: mode === m ? '#1b1b1b' : '#fff', color: mode === m ? '#fff' : '#1b1b1b' }}>
              {m === 'both' ? 'একসাথে দুটো (both at once)' : 'একটার পর একটা (one after the other)'}
            </button>
          ))}
        </div>

        <input value={said} onChange={(e) => setSaid(e.target.value)} placeholder="যা বলবেন (optional) — e.g. দুইটা ছোট মাছ ভুনা আর ভাত দেন"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #ccc', fontSize: 15, marginBottom: 12 }} />

        <button onClick={onButton} disabled={state === 'working'}
          style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', fontSize: 17, fontWeight: 600,
            background: state === 'recording' ? '#c62828' : '#1b1b1b', color: '#fff' }}>
          {label}
        </button>
        <p style={{ fontSize: 12, color: '#777', margin: '6px 0 0' }}>Tap to start, tap to stop (max 20 s).</p>
        <label style={{ display: 'block', marginTop: 12, padding: '12px', borderRadius: 14, border: '1px dashed #999',
          textAlign: 'center', fontSize: 15, background: '#fff', opacity: state === 'idle' ? 1 : 0.5 }}>
          ⬆ আগের রেকর্ডিং দিন (Upload a recording) — MP3 / WAV / M4A
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" disabled={state !== 'idle'} style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </label>
        <p style={{ fontSize: 12, color: '#777', margin: '6px 0 0' }}>
          A turn from before: AI conversations (Cortex / admin) → ▶ Listen → ⋮ → Download, then upload it here.
        </p>
        {warn && <p style={{ background: '#fff4e5', border: '1px solid #f0c27b', borderRadius: 10, padding: 10, fontSize: 14 }}>{warn}</p>}

        {tries.map((t) => (
          <div key={t.id} style={{ background: '#fff', border: '1px solid #e3e3e0', borderRadius: 14, padding: 14, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: '#777' }}>{t.at}{t.note ? ` · ${t.note}` : ''}</div>
            {t.said && <div style={{ fontSize: 15, margin: '6px 0 0' }}><b>Said:</b> {t.said}</div>}
            {t.clips.map((c) => (
              <div key={c.kind} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {c.kind === 'clean' ? 'CLEANED — noise suppression on' : c.kind === 'file' ? 'UPLOADED RECORDING' : 'RAW — noise suppression off (as now)'}
                </div>
                <div style={{ fontSize: 12, color: '#777', margin: '2px 0 6px' }}>{c.settings}</div>
                <audio controls src={c.url} style={{ width: '100%' }} />
                {c.heard.map((h) => (
                  <div key={h.label} style={{ marginTop: 6, fontSize: 15 }}>
                    <span style={{ fontSize: 12, color: '#777' }}>{h.label}{h.ms ? ` · ${(h.ms / 1000).toFixed(1)} s` : ''}: </span>
                    {h.error ? <span style={{ color: '#c62828' }}>{h.error}</span> : <span>{h.text}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
