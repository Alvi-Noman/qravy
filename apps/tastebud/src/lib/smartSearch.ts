import fuzzysort from "fuzzysort";

export type SearchableItem = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
};

// fuzzysort's type namespace is `Fuzzysort` (capital F)
type Match = Fuzzysort.Result; // result from fuzzysort.single

export type Ranked<T> = {
  item: T;
  score: number;
  fields: {
    name?: Match;
    description?: Match;
    category?: Match;
    tags?: Match;
  };
};

const NORMALIZE = (s?: string | null) =>
  (s ?? "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Parse VS Code–ish query:
 * - space-separated tokens (AND)
 * - quoted phrases kept intact
 * - leading "!" negates a token (NOT)
 */
export function parseQuery(q: string) {
  const tokens: string[] = [];
  const neg: string[] = [];

  q.match(/"([^"]+)"|[^\s]+/g)?.forEach((raw) => {
    const t = raw.startsWith('"') ? raw.slice(1, -1) : raw;
    if (t.startsWith("!")) neg.push(NORMALIZE(t.slice(1)));
    else tokens.push(NORMALIZE(t));
  });

  return { tokens, neg };
}

/** VS Code–like fuzzy search across name/description/category/tags */
export function smartSearch<T extends SearchableItem>(
  query: string,
  items: T[],
  opts?: {
    limit?: number;
    boostName?: number;
    boostCategory?: number;
  }
): Ranked<T>[] {
  const q = query.trim();
  if (!q) return [];

  const { tokens, neg } = parseQuery(q);
  if (tokens.length === 0 && neg.length === 0) return [];

  const limit = opts?.limit ?? 200;
  const boostName = opts?.boostName ?? 2.0;
  const boostCategory = opts?.boostCategory ?? 1.2;

  // Pre-normalize fields for fuzzysort
  const prepared = items.map((it) => ({
    raw: it,
    keys: {
      name: NORMALIZE(it.name),
      description: NORMALIZE(it.description),
      category: NORMALIZE(it.category),
      tags: (it.tags ?? []).map(NORMALIZE).join(" "),
    },
  }));

  // Basic NOT filtering (fast prefilter)
  const afterNot = neg.length
    ? prepared.filter((p) => {
        const bank = `${p.keys.name} ${p.keys.description} ${p.keys.category} ${p.keys.tags}`;
        return !neg.some((n) => bank.includes(n));
      })
    : prepared;

  // For multi-token AND: each token must match somewhere
  const ANDed: Ranked<T>[] = [];
  for (const p of afterNot) {
    let totalScore = 0;
    const fields: Ranked<T>["fields"] = {};
    let ok = true;

    for (const tk of tokens) {
      // Rank per field, keep best
      const rName = fuzzysort.single(tk, p.keys.name);
      const rDesc = p.keys.description ? fuzzysort.single(tk, p.keys.description) : null;
      const rCat = p.keys.category ? fuzzysort.single(tk, p.keys.category) : null;
      const rTags = p.keys.tags ? fuzzysort.single(tk, p.keys.tags) : null;

      const fieldScores: Array<{ s: number; which: keyof typeof fields; res: Match }> = [];
      if (rName) fieldScores.push({ s: rName.score * boostName, which: "name", res: rName });
      if (rDesc) fieldScores.push({ s: rDesc.score, which: "description", res: rDesc });
      if (rCat) fieldScores.push({ s: rCat.score * boostCategory, which: "category", res: rCat });
      if (rTags) fieldScores.push({ s: rTags.score, which: "tags", res: rTags });

      // If no field matched this token → fail the AND
      if (fieldScores.length === 0) {
        ok = false;
        break;
      }

      // Choose the best field for this token
      fieldScores.sort((a, b) => a.s - b.s); // fuzzysort: more negative = better
      totalScore += fieldScores[0].s;
      const best = fieldScores[0];
      (fields as any)[best.which] = best.res;
    }

    if (ok) {
      ANDed.push({
        item: p.raw,
        score: totalScore,
        fields,
      });
    }
  }

  // Lower (more negative) is better in fuzzysort -> sort ascending
  ANDed.sort((a, b) => a.score - b.score);
  return ANDed.slice(0, limit);
}

/** Optional helper to highlight fuzzysort ranges in a string */
export function highlight(text: string, res?: Match) {
  if (!res) return text;
  // Fuzzysort's .indexes is non-standardly typed; treat as any
  const idx = (res as any).indexes as number[] | undefined;
  if (!idx || !idx.length) return text;

  let out = "";
  let last = 0;
  for (const i of idx) {
    if (i > last) out += text.slice(last, i);
    out += `<mark>${text[i]}</mark>`;
    last = i + 1;
  }
  out += text.slice(last);
  return out;
}
