// services/auth-service/src/routes/replayRoutes.ts
// Session recordings of the storefront, for Cortex (apps/cortex → a guest session → "Recording").
// POST /api/v1/public/replay — the storefront's recorder (apps/tastebud/src/utils/replay.ts) sends what the page
// looked like and what the guest did, a few seconds at a time, as rrweb events (not a video file: the page is rebuilt
// and replayed). Typed text is masked in the browser (every input, and the guest's own name / phone / address shown
// back on the order page, which carry the "rr-mask" class); nothing typed ever leaves the phone.
// Stored gzipped, one document per chunk, under the same visit id as the guest's events (guestEvents.vid).
// Kept 30 days (TTL index in initDb).
import express, { type Request, type Response } from 'express';
import { Binary } from 'mongodb';
import { gunzipSync, gzipSync } from 'node:zlib';
import { client } from '../db.js';
import { tenantIdOf } from './eventsRoutes.js';

const router: express.Router = express.Router();

export const guestReplays = () => client.db('authDB').collection('guestReplays');

/** Enough for hours of a visit; past it the recorder stops being stored (a stuck page, a tab left open for days). */
const MAX_CHUNKS_PER_VISIT = 3000;
/** One chunk, unpacked (a first snapshot of a big menu page with its styles is a few MB at most). */
const MAX_UNPACKED = 24 * 1024 * 1024;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

router.post('/public/replay', async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sub = str(b.sub, 64).toLowerCase();
    const did = str(b.did, 64);
    const vid = str(b.vid, 64);
    const seq = Number(b.seq);
    const raw = typeof b.data === 'string' ? b.data : '';
    if (!sub || !did || !vid || !Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS_PER_VISIT || !raw) {
      return res.status(204).end();
    }
    const tenantId = await tenantIdOf(sub);
    if (!tenantId) return res.status(204).end();

    // gzip from the browser (base64), or plain JSON (the last few seconds, sent while the page closes)
    let packed: Buffer;
    let unpacked: Buffer;
    if (b.enc === 'gz') {
      packed = Buffer.from(raw, 'base64');
      unpacked = gunzipSync(packed, { maxOutputLength: MAX_UNPACKED });
    } else {
      unpacked = Buffer.from(raw, 'utf8');
      if (unpacked.length > MAX_UNPACKED) return res.status(204).end();
      packed = gzipSync(unpacked);
    }
    // a list of rrweb events (each has a type and a timestamp) — anything else is dropped
    const events = JSON.parse(unpacked.toString('utf8')) as unknown;
    if (!Array.isArray(events) || !events.length) return res.status(204).end();
    const stamps = events.map((e) => Number((e as { timestamp?: unknown })?.timestamp)).filter(Number.isFinite);
    if (stamps.length !== events.length) return res.status(204).end();

    // the same chunk sent twice (a retry) is stored once
    await guestReplays().updateOne(
      { vid, seq },
      {
        $setOnInsert: {
          tenantId,
          sub,
          did,
          vid,
          seq,
          t0: new Date(Math.min(...stamps)),
          t1: new Date(Math.max(...stamps)),
          n: events.length,
          bytes: packed.length,
          data: new Binary(packed),
          at: new Date(),
        },
      },
      { upsert: true }
    );
    return res.status(204).end();
  } catch {
    return res.status(204).end(); // recording never bothers the guest
  }
});

/** A visit's recording, in order (for Cortex). Empty when the visit wasn't recorded. */
export async function replayEventsOf(vid: string): Promise<unknown[]> {
  const chunks = await guestReplays()
    .find({ vid }, { projection: { seq: 1, data: 1 } })
    .sort({ seq: 1 })
    .toArray();
  const out: Array<{ timestamp: number }> = [];
  for (const c of chunks) {
    try {
      const buf = Buffer.from((c.data as Binary).buffer);
      out.push(...(JSON.parse(gunzipSync(buf).toString('utf8')) as Array<{ timestamp: number }>));
    } catch {
      /* a damaged chunk is skipped; the rest still plays */
    }
  }
  // chunks are sent in order, but a slow one can land after the next: time order is what the player needs
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/** Which of these visits have a recording. */
export async function visitsWithReplay(vids: string[]): Promise<Set<string>> {
  if (!vids.length) return new Set();
  const found = await guestReplays().distinct('vid', { vid: { $in: vids }, seq: 0 });
  return new Set(found.map(String));
}

export default router;
