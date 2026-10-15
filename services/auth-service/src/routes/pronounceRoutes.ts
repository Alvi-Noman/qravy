// services/auth-service/src/routes/pronounceRoutes.ts
// Qravy's pronunciation dictionary — ONE for the whole platform. A word the Bangla voice says wrong ("ষোল" read "shol")
// is fixed once and every restaurant's waiter says it the fixed way from then on. Only Qravy changes it (Cortex):
// a restaurant SENDS A REQUEST from its Settings → AI Waiter, and Qravy accepts it (as sent or edited) or declines it.
// Each word keeps its history (who changed it, from what, when), so a bad change can be undone.
//   /public/pronounce?text=sholo        what the voice will read ("শোলো") — the live preview while typing
//   /pronunciations                      a restaurant's view: only its own words and requests (waiting / approved / declined)
//   /cortex/pronunciations               Qravy's view: everything + who / history / revert / remove + the requests
// The storefront gets the dictionary with the restaurant's info (publicRoutes), the waiter reads it (server.py).
import express, { type Request, type Response, type NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { client } from '../db.js';
import { requireCortex } from '../utils/cortexAuth.js';
import { authenticateJWT } from '../middleware/auth.js';
import { denyBranchSession } from '../middleware/scope.js';
import { toSpoken } from '../utils/pronounce.js';

const router: express.Router = express.Router();

// kind 'restaurant' only on words moved from the old per-restaurant lists; an accepted request is Qravy's, with `requestedBy`
type Actor = {
  kind: 'qravy' | 'restaurant';
  tenantId?: string;
  tenantName?: string;
  by?: string;
  requestedBy?: { tenantId: string; tenantName: string };
};
type Change = { sayAs: string; spoken: string; at: Date; actor: Actor; action: 'set' | 'remove' | 'revert' };
export type LexEntry = {
  _id: string; // the word in lower case
  word: string;
  sayAs: string;
  spoken: string;
  locked: boolean; // from when restaurants changed words directly; nothing reads it now
  removed?: boolean;
  actor: Actor;
  updatedAt: Date;
  history: Change[];
};

/** A restaurant's request to add or change a word; Qravy accepts it (maybe edited) or declines it. */
export type PronounceRequest = {
  _id?: ObjectId;
  key: string; // the word in lower case
  word: string;
  sayAs: string;
  spoken: string;
  note?: string; // the restaurant's note
  tenantId: string;
  tenantName: string;
  by: string; // who at the restaurant
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
  updatedAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  final?: { sayAs: string; spoken: string }; // what Qravy put in the dictionary (differs when edited)
  reply?: string; // Qravy's note back
};

export const lexicon = () => client.db('authDB').collection<LexEntry>('lexicon');
export const pronounceRequests = () => client.db('authDB').collection<PronounceRequest>('pronounceRequests');
const MAX_PENDING = 50;
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

/** Who fixed it, as a restaurant sees it — another restaurant stays anonymous. */
const byFor = (a: Actor, tenantId: string): 'qravy' | 'you' | 'another restaurant' =>
  a.kind === 'restaurant' ? (a.tenantId === tenantId ? 'you' : 'another restaurant') : a.requestedBy?.tenantId === tenantId ? 'you' : 'qravy';

const requestView = (r: PronounceRequest) => ({
  id: String(r._id),
  word: r.word,
  sayAs: r.sayAs,
  spoken: r.spoken,
  note: r.note ?? '',
  status: r.status,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt ?? null,
  final: r.final ?? null,
  reply: r.reply ?? '',
});

router.get(
  '/pronunciations',
  ...restaurantGuard,
  wrap(async (req, res) => {
    const tenantId = String(req.user?.tenantId ?? '');
    // a restaurant sees only its own words (ones Qravy accepted from it, or moved from its old list) — the dictionary
    // itself is Qravy's, and other restaurants' words stay private
    const docs = await lexicon()
      .find({ removed: { $ne: true }, $or: [{ 'actor.requestedBy.tenantId': tenantId }, { 'actor.kind': 'restaurant', 'actor.tenantId': tenantId }] })
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray();
    res.json({
      success: true,
      items: docs.map((d) => ({ word: d.word, sayAs: d.sayAs, spoken: d.spoken, by: byFor(d.actor, tenantId), updatedAt: d.updatedAt })),
    });
  })
);

/** This restaurant's requests, newest first (waiting, accepted, declined). */
router.get(
  '/pronunciations/requests',
  ...restaurantGuard,
  wrap(async (req, res) => {
    const tenantId = String(req.user?.tenantId ?? '');
    const docs = await pronounceRequests().find({ tenantId }).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json({ success: true, items: docs.map(requestView) });
  })
);

/** Ask Qravy to add or change a word. Another request for the same word, while the first waits, replaces it. */
router.put(
  '/pronunciations',
  ...restaurantGuard,
  wrap(async (req, res) => {
    const actor = await restaurantActor(req);
    const tenantId = actor.tenantId as string;
    const w = String(req.body?.word ?? '').trim().replace(/\s+/g, ' ');
    const s = String(req.body?.sayAs ?? '').trim().replace(/\s+/g, ' ');
    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    if (!w || w.length > 60) return res.status(400).json({ success: false, message: 'The word must be 1–60 characters.' });
    if (!s || s.length > 80) return res.status(400).json({ success: false, message: 'How to say it must be 1–80 characters.' });
    const spoken = toSpoken(s);
    if (!spoken) return res.status(400).json({ success: false, message: 'Type how to say it in English letters or in Bangla.' });
    const key = keyOf(w);
    const cur = await lexicon().findOne({ _id: key, removed: { $ne: true } });
    if (cur && toSpoken(cur.sayAs) === spoken) {
      return res.status(409).json({ success: false, message: `“${cur.word}” is already said that way.` });
    }
    const now = new Date();
    const mine = await pronounceRequests().findOne({ tenantId, key, status: 'pending' });
    if (mine) {
      await pronounceRequests().updateOne({ _id: mine._id }, { $set: { word: w, sayAs: s, spoken, note, by: actor.by ?? '', updatedAt: now } });
      return res.json({ success: true, item: requestView({ ...mine, word: w, sayAs: s, spoken, note, updatedAt: now }) });
    }
    if ((await pronounceRequests().countDocuments({ tenantId, status: 'pending' })) >= MAX_PENDING) {
      return res.status(429).json({ success: false, message: `You have ${MAX_PENDING} requests waiting — Qravy will review those first.` });
    }
    const doc: PronounceRequest = {
      key,
      word: w,
      sayAs: s,
      spoken,
      note,
      tenantId,
      tenantName: actor.tenantName ?? '',
      by: actor.by ?? '',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    const r = await pronounceRequests().insertOne(doc);
    res.json({ success: true, item: requestView({ ...doc, _id: r.insertedId }) });
  })
);

/** Take back a request that's still waiting. */
router.delete(
  '/pronunciations/requests/:id',
  ...restaurantGuard,
  wrap(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!ObjectId.isValid(id)) return res.status(404).json({ success: false, message: 'No such request.' });
    const r = await pronounceRequests().deleteOne({ _id: new ObjectId(id), tenantId: String(req.user?.tenantId ?? ''), status: 'pending' });
    res.status(r.deletedCount ? 200 : 404).json({ success: !!r.deletedCount });
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

/* ------------------------------------------------------------------ restaurants' requests (Cortex) */

router.get(
  '/cortex/pronunciations/requests',
  requireCortex,
  wrap(async (req, res) => {
    const decided = req.query.status === 'decided';
    const docs = await pronounceRequests()
      .find(decided ? { status: { $ne: 'pending' } } : { status: 'pending' })
      .sort(decided ? { decidedAt: -1 } : { createdAt: 1 })
      .limit(decided ? 200 : 1000)
      .toArray();
    // what each word is now, to compare with
    const now = await lexicon()
      .find({ _id: { $in: [...new Set(docs.map((d) => d.key))] }, removed: { $ne: true } }, { projection: { sayAs: 1, spoken: 1, actor: 1 } })
      .toArray();
    const current = new Map(now.map((d) => [d._id, { sayAs: d.sayAs, spoken: d.spoken, actor: d.actor }]));
    res.json({
      success: true,
      pending: decided ? await pronounceRequests().countDocuments({ status: 'pending' }) : docs.length,
      items: docs.map((d) => ({ ...d, _id: String(d._id), current: current.get(d.key) ?? null })),
    });
  })
);

async function pendingRequest(id: string): Promise<PronounceRequest | null> {
  return ObjectId.isValid(id) ? pronounceRequests().findOne({ _id: new ObjectId(id), status: 'pending' }) : null;
}

/** Accept — as the restaurant sent it, or with Qravy's own `sayAs`. It goes into the dictionary for every restaurant. */
router.post(
  '/cortex/pronunciations/requests/:id/accept',
  requireCortex,
  wrap(async (req, res) => {
    const r = await pendingRequest(String(req.params.id ?? ''));
    if (!r) return res.status(404).json({ success: false, message: 'This request was already handled or taken back.' });
    try {
      const sayAs = String(req.body?.sayAs ?? '').trim() || r.sayAs;
      const qravy = cortexActor(req);
      const doc = await setWord(r.word, sayAs, { ...qravy, requestedBy: { tenantId: r.tenantId, tenantName: r.tenantName } });
      const at = new Date();
      await pronounceRequests().updateOne(
        { _id: r._id },
        {
          $set: {
            status: 'accepted',
            decidedAt: at,
            decidedBy: qravy.by ?? '',
            final: { sayAs: doc.sayAs, spoken: doc.spoken },
            reply: String(req.body?.reply ?? '').trim().slice(0, 300),
            updatedAt: at,
          },
        }
      );
      res.json({ success: true, item: doc });
    } catch (e) {
      send(res, e);
    }
  })
);

router.post(
  '/cortex/pronunciations/requests/:id/decline',
  requireCortex,
  wrap(async (req, res) => {
    const r = await pendingRequest(String(req.params.id ?? ''));
    if (!r) return res.status(404).json({ success: false, message: 'This request was already handled or taken back.' });
    const at = new Date();
    await pronounceRequests().updateOne(
      { _id: r._id },
      { $set: { status: 'declined', decidedAt: at, decidedBy: cortexActor(req).by ?? '', reply: String(req.body?.reply ?? '').trim().slice(0, 300), updatedAt: at } }
    );
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
