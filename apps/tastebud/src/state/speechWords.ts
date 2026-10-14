// apps/tastebud/src/state/speechWords.ts — words the Bangla voice says wrong, and how to say them (pure: no Azure, no Vite).
// The Bangla voice guesses the unwritten "o" (inherent vowel) wrong on some words: "স্বাগতম" → "shagtom",
// "ঝাল" → "jhalo". It is fed a respelling that forces the right sound (explicit ো / hasant ্); the screen still shows
// the normal spelling. Whole words only. Restaurants (and Qravy, in Cortex) teach more: "ষোলআনা" → "শোলো আনা" — one
// written word can become several spoken ones, so the voice's word events are mapped back by POSITION (speechPlan).
const BN_SAY: Array<[written: string, said: string]> = [
  ["স্বাগতম", "স্বাগোতম"], // shagotom, not shagtom
  ["ঝাল", "ঝাল্"], // jhal, not jhalo
];
const BN_LETTER = "ঀ-৿";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// the pattern for one word: Bangla as written, English letters whatever their capitals (the whole pass is /gi)
const pattern = (w: string) =>
  /[ঀ-৿]/.test(w) ? `(?<![${BN_LETTER}])${escapeRe(w)}(?![${BN_LETTER}])` : `(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`;

type SayRule = { written: string; said: string };
const BUILT_IN: SayRule[] = BN_SAY.map(([written, said]) => ({ written, said }));

// learned pronunciations (Cortex for every restaurant, Settings → AI Waiter for this one), longer words first
// ("sholo aana" before "sholo"); they come before the built-ins
let LEARNED: SayRule[] = [];
let PASS: { re: RegExp; rules: SayRule[] } | null = null;

export function setPronunciations(list: Array<{ word?: string; spoken?: string }> | null | undefined): void {
  LEARNED = (list ?? [])
    .filter((x): x is { word: string; spoken: string } => !!x?.word?.trim() && !!x?.spoken?.trim())
    .sort((a, b) => b.word.trim().length - a.word.trim().length)
    .map((x) => ({ written: x.word.trim(), said: x.spoken.trim() }));
  PASS = null;
}

/** One regex over every rule (each its own group), so the text is rewritten in a single pass with known positions. */
function pass() {
  if (!PASS) {
    const rules = [...LEARNED, ...BUILT_IN];
    PASS = { rules, re: new RegExp(rules.map((r) => `(${pattern(r.written)})`).join("|"), "gi") };
  }
  return PASS;
}

export type SpeechPlan = {
  /** what the voice is given */
  spoken: string;
  /** where in `spoken` a word was replaced, and what the screen shows for it */
  spans: Array<{ start: number; end: number; written: string }>;
};

/** The text for the voice, and the stretches of it that stand for a different written word. */
export function speechPlan(text: string): SpeechPlan {
  const { re, rules } = pass();
  const spans: SpeechPlan["spans"] = [];
  if (!rules.length) return { spoken: text, spans };
  let spoken = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const i = m.slice(1).findIndex((g) => g !== undefined);
    const r = rules[i];
    if (!r || !m[0]) {
      re.lastIndex += 1;
      continue;
    }
    spoken += text.slice(last, m.index);
    spans.push({ start: spoken.length, end: spoken.length + r.said.length, written: m[0] });
    spoken += r.said;
    last = m.index + m[0].length;
  }
  return { spoken: spoken + text.slice(last), spans };
}

export function forSpeech(text: string): string {
  return speechPlan(text).spoken;
}

/** What the screen shows for a word the voice says at `offset` (its position in the spoken text): the written word for
 *  the first spoken word of a replaced stretch, nothing for the rest of it ("শোলো আনা" → "ষোলআনা", then ""), the word
 *  itself otherwise. Without a position: a single-word replacement is still mapped back. */
export function wordToShow(plan: SpeechPlan | null, word: string, offset?: number): string {
  if (plan && typeof offset === "number" && offset >= 0) {
    const end = offset + word.length;
    // the replaced stretch this spoken word touches (a word event may carry punctuation: "\"শোলো")
    const s = plan.spans.find((x) => offset < x.end && end > x.start);
    if (!s) return word;
    const before = s.start > offset ? word.slice(0, s.start - offset) : ""; // "\"" before it
    const after = end > s.end ? word.slice(word.length - (end - s.end)) : ""; // "।" after it
    const head = offset <= s.start ? s.written : ""; // the written word once, at the stretch's first spoken word
    return before + head + after;
  }
  return fromSpeech(word);
}

export function fromSpeech(word: string): string {
  const w = word.trim();
  const r = [...LEARNED, ...BUILT_IN].find((x) => x.said === w);
  return r ? word.replace(w, r.written) : word;
}
