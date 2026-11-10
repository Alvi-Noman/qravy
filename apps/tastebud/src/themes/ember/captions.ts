// apps/tastebud/src/themes/ember/captions.ts
// Pixie's words as the Ember design colours them: what's been said in white, what's still to come dimmed, and the
// restaurant's own dish names in amber. When she has finished, the first sentence stays white and the rest is dimmed
// (the answer first, the follow-up softer). Dish names come from the restaurant's menu — never from code.
// (Pure — no React — so it is unit-tested on its own: __tests__/emberCaptions.test.ts.)

export type Span = { text: string; color: string };

export const CAPTION_COLORS = { text: '#F5F5F7', amber: '#F5A524', dim: '#8E8E93' };

/** Where each of these dish names appears in `text` (case-insensitive, whole words, longest name first). */
export function dishRanges(text: string, names: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  const sorted = Array.from(new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))).sort((a, b) => b.length - a.length);
  // a letter or digit (Latin, accented Latin, Bangla) — a dish name must stand as whole words
  const isWord = (ch: string | undefined) => !!ch && /[A-Za-z0-9À-ɏঀ-৿]/.test(ch);
  for (const name of sorted) {
    const n = name.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const at = lower.indexOf(n, from);
      if (at < 0) break;
      const end = at + n.length;
      const whole = !isWord(lower[at - 1]) && !isWord(lower[end]);
      if (whole && !out.some(([a, b]) => at < b && end > a)) out.push([at, end]);
      from = at + 1;
    }
  }
  return out;
}

export function captionSpans({
  text,
  spoken,
  dishes,
  dim = CAPTION_COLORS.dim,
  firstSentenceBright = true,
}: {
  /** the whole line */
  text: string;
  /** while speaking: the words said so far (the rest is still to come); null when she has finished */
  spoken: string | null;
  dishes: string[];
  dim?: string;
  firstSentenceBright?: boolean;
}): Span[] {
  const ranges = dishRanges(text, dishes);
  const saidWords = spoken == null ? null : spoken.trim().split(/\s+/).filter(Boolean).length;
  const firstEnd = (() => {
    const m = /[.!?।](\s|$)/.exec(text);
    return m ? m.index + 1 : text.length;
  })();
  const spans: Span[] = [];
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  let word = 0;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    const said = saidWords == null ? (firstSentenceBright ? start < firstEnd : true) : word < saidWords;
    const inDish = ranges.some(([a, b]) => start < b && end > a);
    const ahead = saidWords != null && !said;
    const color = ahead ? dim : inDish ? CAPTION_COLORS.amber : said ? CAPTION_COLORS.text : dim;
    const last = spans[spans.length - 1];
    if (last && last.color === color) last.text += m[0];
    else spans.push({ text: m[0], color });
    word += 1;
  }
  return spans;
}

/** Which card's dish Pixie is saying right now: the card whose name (as written on the menu, or as the voice says it
 *  — `dishSaid` from the waiter) started most recently within the first `saidWords` words of `text`. null: none yet. */
export function sayingIndex(
  text: string,
  saidWords: number,
  cards: Array<{ id?: unknown; name?: unknown }>,
  dishSaid: Array<{ id: string; said: string }> = [],
): number | null {
  if (!text || saidWords <= 0) return null;
  let best: number | null = null;
  let bestAt = -1;
  cards.forEach((c, i) => {
    const id = String(c.id ?? '');
    const forms = [String(c.name ?? ''), ...dishSaid.filter((d) => String(d.id) === id).map((d) => String(d.said || ''))].filter(Boolean);
    for (const [at] of dishRanges(text, forms)) {
      const before = text.slice(0, at).trim();
      const word = before ? before.split(/\s+/).length : 0;
      if (word < saidWords && at > bestAt) {
        bestAt = at;
        best = i;
      }
    }
  });
  return best;
}
