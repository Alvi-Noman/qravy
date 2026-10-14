// services/auth-service/src/routes/pronounceRoutes.ts
// Qravy's pronunciation dictionary — ONE for the whole platform. A word the Bangla voice says wrong ("ষোল" read "shol")
// is fixed once — from Cortex or from any restaurant's Settings → AI Waiter — and every restaurant's waiter says it the
// fixed way from then on. Each word keeps its history (who changed it, from what, when), so a bad change can be undone,
// and Qravy can lock a word so restaurants can't change it.
//   /public/pronounce?text=sholo        what the voice will read ("শোলো") — the live preview while typing
//   /pronunciations                      a restaurant's view: the dictionary; add / improve / remove its own words
//   /cortex/pronunciations               Qravy's view: everything + who / history / lock / revert / remove
// The storefront gets the dictionary with the restaurant's info (publicRoutes), the waiter reads it (server.py).
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import { requireCortex } from '../utils/cortexAuth.js';
import { authenticateJWT } from '../middleware/auth.js';
import { denyBranchSession } from '../middleware/scope.js';
import { toSpoken } from '../utils/pronounce.js';

const router: express.Router = express.Router();

type Actor = { kind: 'qravy' | 'restaurant'; tenantId?: string; tenantName?: string; by?: string };
type Change = { sayAs: string; spoken: string; at: Date; actor: Actor; action: 'set' | 'remove' | 'revert' };
export type LexEntry = {
  _id: string; // the word in lower case
  word: string;
  sayAs: string;
  spoken: string;
  locked: boolean;
  removed?: boolean;
  actor: Actor;
  updatedAt: Date;
  history: Change[];
};

export const lexicon = () => client.db('authDB').collection<LexEntry>('lexicon');
const HISTORY = 30;
const keyOf = (word: string) => word.trim().replace(/\s+/g, ' ').toLowerCase();

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/* ------------------------------------------------------------------ the dictionary for the voice */

let cache: { at: number; list: Array<{ word: string; spoken: string }> } | null = null;

/** Every word's current fix — what the storefront's voice and the waiter use (kept 30 seconds). */
export async function lexiconList(): Promise<Array<{ word: string; spoken: string }>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.list;
  const docs = await lexicon().find({ removed: { $ne: true } }, { projection: { word: 1, spoken: 1, sayAs: 1 } }).toArray();
  // spelled again from what was typed, so a better converter improves words saved before it
  const list = docs.map((d) => ({ word: d.word, spoken: (d.sayAs && toSpoken(d.sayAs)) || d.spoken })).filter((x) => x.word && x.spoken);
  cache = { at: Date.now(), list };
  return list;
}

/* ------------------------------------------------------------------ changing it */

class Refused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Sets a word's fix (a new one, or improving the current one); its old value goes into the history. */
async function setWord(word: string, sayAs: string, actor: Actor, opts: { lock?: boolean } = {}): Promise<LexEntry> {
  const w = word.trim().replace(/\s+/g, ' ');
  const s = sayAs.trim().replace(/\s+/g, ' ');
  if (!w || w.length > 60) throw new Refused(400, 'The word must be 1–60 characters.');
  if (!s || s.length > 80) throw new Refused(400, 'How to say it must be 1–80 characters.');
  const spoken = toSpoken(s);
  if (!spoken) throw new Refused(400, 'Type how to say it in English letters or in Bangla.');
  const _id = keyOf(w);
  const cur = await lexicon().findOne({ _id });
  if (cur?.locked && !cur.removed && actor.kind !== 'qravy') {
    throw new Refused(423, `“${cur.word}” is set by Qravy and can’t be changed here.`);
  }
  const now = new Date();
  const locked = opts.lock ?? (actor.kind === 'qravy' ? true : cur?.removed ? false : (cur?.locked ?? false));
  const history = [
    ...(cur?.history ?? []),
    ...(cur && !cur.removed ? [{ sayAs: cur.sayAs, spoken: cur.spoken, at: cur.updatedAt, actor: cur.actor, action: 'set' as const }] : []),
  ].slice(-HISTORY);
  const doc: LexEntry = { _id, word: w, sayAs: s, spoken, locked, actor, updatedAt: now, history, removed: false };
  await lexicon().replaceOne({ _id }, doc, { upsert: true });
  cache = null;
  return doc;
}

/** Takes a word out of the dictionary (kept, marked removed, so its history stays and it can come back). */
async function removeWord(word: string, actor: Actor): Promise<void> {
  const _id = keyOf(word);
  const cur = await lexicon().findOne({ _id });
  if (!cur || cur.removed) return;
  if (actor.kind !== 'qravy') {
    if (cur.locked) throw new Refused(423, `“${cur.word}” is set by Qravy and can’t be removed here.`);
    if (cur.actor.tenantId !== actor.tenantId) {
      throw new Refused(403, 'Only the restaurant that added a word (or Qravy) can remove it — you can improve it instead.');
    }
  }
  const history = [...cur.history, { sayAs: cur.sayAs, spoken: cur.spoken, at: cur.updatedAt, actor: cur.actor, action: 'set' as const }].slice(-HISTORY);
  await lexicon().updateOne({ _id }, { $set: { removed: true, actor, updatedAt: new Date(), history } });
  cache = null;
}

const send = (res: Response, e: unknown) => {
  if (e instanceof Refused) return res.status(e.status).json({ success: false, message: e.message });
  throw e;
};

/* ------------------------------------------------------------------ the live preview */

router.get('/public/pronounce', (req, res) => {
  const text = String(req.query.text ?? '').slice(0, 80);
  res.set('Cache-Control', 'no-store');
  res.json({ spoken: toSpoken(text) });
});

/* ------------------------------------------------------------------ a restaurant's view */

async function restaurantActor(req: Request): Promise<Actor> {
  const tenantId = String(req.user?.tenantId ?? '');
  const t = ObjectId.isValid(tenantId)
    ? await client.db('authDB').collection('tenants').findOne({ _id: new ObjectId(tenantId) }, { projection: { name: 1 } })
    : null;
  return { kind: 'restaurant', tenantId, tenantName: String(t?.name ?? ''), by: String((req.user as { email?: string } | undefined)?.email ?? '') };
}
const restaurantGuard = [authenticateJWT, denyBranchSession];

router.get(
  '/pronunciations',
  ...restaurantGuard,
  wrap(async (req, res) => {
    const tenantId = String(req.user?.tenantId ?? '');
    const docs = await lexicon().find({ removed: { $ne: true } }).sort({ updatedAt: -1 }).limit(2000).toArray();
    res.json({
      success: true,
      items: docs.map((d) => ({
        word: d.word,
        sayAs: d.sayAs,
        spoken: d.spoken,
        locked: d.locked,
        // who fixed it — another restaurant stays anonymous
        by: d.actor.kind === 'qravy' ? 'qravy' : d.actor.tenantId === tenantId ? 'you' : 'another restaurant',
        updatedAt: d.updatedAt,
      })),
    });
  })
);

router.put(
  '/pronunciations',
  ...restaurantGuard,
  wrap(async (req, res) => {
    try {
      const actor = await restaurantActor(req);
      const { word, sayAs, previousWord } = req.body ?? {};
      const doc = await setWord(String(word ?? ''), String(sayAs ?? ''), actor);
      // renamed (the waiter's name): the old word goes if it was theirs
      if (previousWord && keyOf(String(previousWord)) !== doc._id) {
        await removeWord(String(previousWord), actor).catch(() => undefined);
      }
      res.json({ success: true, item: { word: doc.word, sayAs: doc.sayAs, spoken: doc.spoken, locked: doc.locked } });
    } catch (e) {
      send(res, e);
    }
  })
);

router.delete(
  '/pronunciations/:word',
  ...restaurantGuard,
  wrap(async (req, res) => {
    try {
      await removeWord(String(req.params.word ?? ''), await restaurantActor(req));
      res.json({ success: true });
    } catch (e) {
      send(res, e);
    }
  })
);

/* ------------------------------------------------------------------ Qravy's view (Cortex) */

const cortexActor = (req: Request): Actor => {
  const c = (req as unknown as { cortex?: { email?: string; username?: string } }).cortex;
  return { kind: 'qravy', by: String(c?.email || c?.username || '') };
};

router.get(
  '/cortex/pronunciations',
  requireCortex,
  wrap(async (req, res) => {
    const showRemoved = req.query.removed === '1';
    const docs = await lexicon()
      .find(showRemoved ? {} : { removed: { $ne: true } })
      .sort({ updatedAt: -1 })
      .limit(5000)
      .toArray();
    res.json({ success: true, items: docs });
  })
);

router.put(
  '/cortex/pronunciations',
  requireCortex,
  wrap(async (req, res) => {
    try {
      const { word, sayAs, locked } = req.body ?? {};
      const doc = await setWord(String(word ?? ''), String(sayAs ?? ''), cortexActor(req), { lock: typeof locked === 'boolean' ? locked : true });
      res.json({ success: true, item: doc });
    } catch (e) {
      send(res, e);
    }
  })
);

router.post(
  '/cortex/pronunciations/lock',
  requireCortex,
  wrap(async (req, res) => {
    const _id = keyOf(String(req.body?.word ?? ''));
    const r = await lexicon().updateOne({ _id }, { $set: { locked: !!req.body?.locked } });
    cache = null;
    res.status(r.matchedCount ? 200 : 404).json({ success: !!r.matchedCount });
  })
);

/** Back to the value before the current one (the current one goes into the history too, so a revert can be undone). */
router.post(
  '/cortex/pronunciations/revert',
  requireCortex,
  wrap(async (req, res) => {
    const _id = keyOf(String(req.body?.word ?? ''));
    const cur = await lexicon().findOne({ _id });
    const prev = cur?.history?.[cur.history.length - 1];
    if (!cur || !prev) return res.status(404).json({ success: false, message: 'Nothing to go back to.' });
    const history = [
      ...cur.history.slice(0, -1),
      { sayAs: cur.sayAs, spoken: cur.spoken, at: cur.updatedAt, actor: cur.actor, action: 'revert' as const },
    ].slice(-HISTORY);
    await lexicon().updateOne(
      { _id },
      { $set: { sayAs: prev.sayAs, spoken: prev.spoken, actor: cortexActor(req), updatedAt: new Date(), history, removed: false } }
    );
    cache = null;
    res.json({ success: true, item: await lexicon().findOne({ _id }) });
  })
);

router.delete(
  '/cortex/pronunciations/:word',
  requireCortex,
  wrap(async (req, res) => {
    await removeWord(String(req.params.word ?? ''), cortexActor(req));
    res.json({ success: true });
  })
);

/* ------------------------------------------------------------------ moving the old lists over (once) */

/** The lists from before the dictionary was global — Qravy's (Cortex) and each restaurant's own — become its words. */
export async function migrateOldPronunciations(): Promise<number> {
  const db = client.db('authDB');
  if (await lexicon().estimatedDocumentCount()) return 0;
  let n = 0;
  const platform =
    (await db.collection<{ _id: string; list?: Array<{ word: string; sayAs: string }> }>('pronunciations').findOne({ _id: 'platform' }))?.list ?? [];
  for (const p of platform) {
    if (p?.word && p?.sayAs) {
      await setWord(p.word, p.sayAs, { kind: 'qravy', by: 'moved from the old list' }, { lock: true })
        .then(() => n++)
        .catch(() => undefined);
    }
  }
  const tenants = db.collection('tenants').find({ 'pronunciations.0': { $exists: true } }, { projection: { name: 1, pronunciations: 1 } });
  for await (const t of tenants) {
    for (const p of (t.pronunciations ?? []) as Array<{ word: string; sayAs: string }>) {
      if (p?.word && p?.sayAs) {
        await setWord(p.word, p.sayAs, { kind: 'restaurant', tenantId: String(t._id), tenantName: String(t.name ?? ''), by: 'moved from the old list' })
          .then(() => n++)
          .catch(() => undefined);
      }
    }
  }
  return n;
}

export default router;
