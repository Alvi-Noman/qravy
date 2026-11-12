// apps/tastebud/src/utils/replay.ts
// Session recording of the storefront, for the company's Cortex panel (a guest session → "Recording"):
// rrweb records the page (its layout, and every change, scroll, tap) — not a video, the page is rebuilt and replayed.
// Under the same visit id as utils/track.ts, so the recording sits next to that visit's steps and AI turns.
// Privacy: everything typed is masked here, in the browser (maskAllInputs), and so is any element with the class
// "rr-mask" (the guest's own name / phone / address shown back on the order page). No audio, no camera, no canvas.
// Loaded after the page is up, sent gzipped a few seconds at a time; never in the guest's way.
// Server: services/auth-service/src/routes/replayRoutes.ts (kept 30 days). Off with VITE_REPLAY=0.
import { contextNow } from './track';

type RrwebEvent = { type: number; timestamp: number };

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  ((typeof window !== 'undefined' && (window as any).__STORE__?.apiBase) as string | undefined) ||
  '/api/v1';

const FLUSH_MS = 5_000;
const FLUSH_AT_EVENTS = 300;
/** After this much sent from one page, stop (a tab left open for days; the server caps a visit's chunks too). */
const MAX_VISIT_BYTES = 25 * 1024 * 1024;
/** A keepalive request (the one sent while the page closes) can carry at most 64 KB. */
const KEEPALIVE_MAX = 60 * 1024;

let started = false;
let stopFn: (() => void) | null = null;
let takeFullSnapshot: ((isCheckout?: boolean) => void) | null = null;

let buf: RrwebEvent[] = [];
let timer: number | null = null;
/** the visit being recorded, and how much it has sent from this page */
let rec: { sub: string; did: string; vid: string; bytes: number } | null = null;

const SEQ_KEY = 'qravy:replay-seq';
let memSeq = { vid: '', n: 0 };

/** The visit's next chunk number. Kept in the tab: a reload is the same visit (track.ts), and its chunks go on
 *  from the last page's — restarting at 0 would read as a resend of chunks already stored, and be dropped. */
function nextSeq(vid: string): number {
  let cur = memSeq.vid === vid ? memSeq : { vid, n: 0 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(SEQ_KEY) || 'null') as { vid: string; n: number } | null;
    if (saved && saved.vid === vid && saved.n > cur.n) cur = saved;
  } catch {
    /* in memory only */
  }
  memSeq = { vid, n: cur.n + 1 };
  try {
    sessionStorage.setItem(SEQ_KEY, JSON.stringify(memSeq));
  } catch {
    /* in memory only */
  }
  return cur.n;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** fflate's gzip, loaded with the recorder. Synchronous on purpose: a closing page has no time to wait for the
 *  browser's own (async) CompressionStream, and its last chunk — often a whole page just rendered — must be small
 *  enough for the one keepalive request the page may still send. A few ms for a typical chunk. */
let gzipSync: ((data: Uint8Array, opts?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) => Uint8Array) | null = null;

function gzip(text: string): string {
  return b64(gzipSync!(new TextEncoder().encode(text), { level: 6 }));
}

function post(body: string, keepalive: boolean): void {
  try {
    void fetch(`${API_BASE}/public/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive,
    }).catch(() => {});
  } catch {
    /* never in the way */
  }
}

/** Send what was recorded, gzipped (also as the page goes away: a reload, a link, the tab hidden). */
function flush(): void {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!buf.length) return;
  const ctx = contextNow();
  if (!ctx || ctx.vid === 'nostorage') {
    buf = [];
    return;
  }
  // a new visit (30 quiet minutes, see track.ts): it gets its own recording, starting from a fresh full snapshot
  if (!rec || rec.vid !== ctx.vid || rec.sub !== ctx.sub) {
    const first = !rec;
    rec = { sub: ctx.sub, did: ctx.did, vid: ctx.vid, bytes: 0 };
    if (!first) {
      buf = [];
      takeFullSnapshot?.(true); // emits the page anew into buf; it goes out with the next flush
      schedule();
      return;
    }
  }
  if (rec.bytes > MAX_VISIT_BYTES) {
    buf = [];
    return;
  }
  const events = buf;
  buf = [];
  const r = rec;
  const seq = nextSeq(r.vid);
  try {
    const body = JSON.stringify({ sub: r.sub, did: r.did, vid: r.vid, seq, enc: 'gz', data: gzip(JSON.stringify(events)) });
    r.bytes += body.length;
    // a request that outlives the page when it fits (≤ 64 KB) — so a chunk sent as the page closes still arrives
    post(body, body.length < KEEPALIVE_MAX);
  } catch {
    /* never in the way */
  }
}

function schedule(): void {
  if (!timer) timer = window.setTimeout(() => flush(), FLUSH_MS);
}

/** Start recording this tab (once). Called with the first storefront page view (components/TrackPageViews). */
export function startReplay(): void {
  if (started || typeof window === 'undefined') return;
  if (import.meta.env.VITE_REPLAY === '0') return;
  const ctx = contextNow();
  if (!ctx) return; // not a restaurant's storefront page
  if (ctx.vid === 'nostorage') return; // no visit id of its own (storage blocked): its recording would mix with others
  started = true;

  const go = () => {
    Promise.all([import('rrweb'), import('fflate')])
      .then(([{ record }, fflate]) => {
        gzipSync = fflate.gzipSync;
        takeFullSnapshot = record.takeFullSnapshot;
        stopFn =
          record<RrwebEvent>({
            emit(e) {
              buf.push(e);
              if (buf.length >= FLUSH_AT_EVENTS) flush();
              else schedule();
            },
            maskAllInputs: true, // names, phone numbers, addresses, notes: recorded as ****
            maskTextClass: 'rr-mask',
            // React also writes a <textarea>'s value into its text — which maskAllInputs doesn't cover
            maskTextSelector: 'textarea',
            blockClass: 'rr-block',
            recordCanvas: false,
            collectFonts: false,
            inlineImages: false,
            slimDOMOptions: 'all',
            sampling: { mousemove: 100, scroll: 150, media: 800, input: 'last' },
            errorHandler: () => true, // a recording error is swallowed, never the page's problem
          }) ?? null;
        // the page's first snapshot (emitted by record() just now) goes at once: it is too big for the small request
        // a closing page may send, so waiting for the timer would lose it when the guest leaves or reloads quickly
        flush();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') flush();
        });
        window.addEventListener('pagehide', () => flush());
      })
      .catch(() => {
        /* couldn't load the recorder: the page works as before */
      });
  };
  // after the page has settled: the recorder never slows the first paint
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 3000 });
  else window.setTimeout(go, 1500);
}

/** Stop recording (not used by the storefront today; for tests and a future opt-out). */
export function stopReplay(): void {
  flush();
  stopFn?.();
  stopFn = null;
}
