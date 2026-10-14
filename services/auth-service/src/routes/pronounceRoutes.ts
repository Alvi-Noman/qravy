// services/auth-service/src/routes/pronounceRoutes.ts
// The waiter's pronunciation learner. A word the Bangla voice says wrong ("ষোল" read "shol") gets a "say it like"
// ("sholo") — typed in English letters or Bangla — and the voice reads the word that way from then on.
//   /public/pronounce?text=sholo   what the voice will read ("শোলো") — the live preview while typing
//   /cortex/pronunciations         Qravy's own list, for every restaurant (Cortex)
// A restaurant's own list lives on the restaurant (Settings → AI Waiter, PUT /tenants/me) and wins over Qravy's.
import express, { type Request, type Response, type NextFunction } from 'express';
import { client } from '../db.js';
import { requireCortex } from '../utils/cortexAuth.js';
import { cleanList, toSpoken, type Pronunciation } from '../utils/pronounce.js';

const router: express.Router = express.Router();
const col = () => client.db('authDB').collection<{ _id: string; list: Pronunciation[]; updatedAt?: Date; updatedBy?: string }>('pronunciations');

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

let cache: { at: number; list: Pronunciation[] } | null = null;

/** Qravy's list for every restaurant (kept a minute). */
export async function platformPronunciations(): Promise<Pronunciation[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const doc = await col().findOne({ _id: 'platform' });
  cache = { at: Date.now(), list: doc?.list ?? [] };
  return cache.list;
}

/** What the storefront's voice uses: Qravy's list, then the restaurant's own (same word → the restaurant's). */
export function mergePronunciations(platform: Pronunciation[], own: Pronunciation[] | undefined): Array<{ word: string; spoken: string }> {
  const m = new Map<string, { word: string; spoken: string }>();
  for (const p of [...platform, ...(own ?? [])]) {
    // spelled again from what they typed, so a better converter fixes words saved before it
    const spoken = (p?.sayAs && toSpoken(p.sayAs)) || p?.spoken;
    if (p?.word && spoken) m.set(p.word.toLowerCase(), { word: p.word, spoken });
  }
  return [...m.values()];
}

const MAX = 300;
const valid = (list: unknown): list is Array<{ word?: unknown; sayAs?: unknown }> =>
  Array.isArray(list) &&
  list.length <= MAX &&
  list.every((x) => x && typeof x === 'object' && String((x as any).word ?? '').length <= 60 && String((x as any).sayAs ?? '').length <= 80);

router.get('/public/pronounce', (req, res) => {
  const text = String(req.query.text ?? '').slice(0, 80);
  res.set('Cache-Control', 'no-store');
  res.json({ spoken: toSpoken(text) });
});

router.get(
  '/cortex/pronunciations',
  requireCortex,
  wrap(async (_req, res) => {
    const doc = await col().findOne({ _id: 'platform' });
    res.json({ success: true, list: doc?.list ?? [], updatedAt: doc?.updatedAt ?? null, updatedBy: doc?.updatedBy ?? null });
  })
);

router.put(
  '/cortex/pronunciations',
  requireCortex,
  wrap(async (req, res) => {
    if (!valid(req.body?.list)) return res.status(400).json({ success: false, message: `Up to ${MAX} words: a word (≤ 60 letters) and how to say it (≤ 80).` });
    const list = cleanList(req.body.list);
    const by = String((req as any).cortex?.email || (req as any).cortex?.username || '');
    await col().updateOne({ _id: 'platform' }, { $set: { list, updatedAt: new Date(), updatedBy: by } }, { upsert: true });
    cache = null;
    res.json({ success: true, list });
  })
);

export default router;
