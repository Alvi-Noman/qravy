// apps/tastebud/src/state/speechWords.ts — words the Bangla voice says wrong, and how to say them (pure: no Azure, no Vite).
// The Bangla voice guesses the unwritten "o" (inherent vowel) wrong on some words: "স্বাগতম" → "shagtom",
// "ঝাল" → "jhalo". It is fed a respelling that forces the right sound (explicit ো / hasant ্); the word
// events are mapped back so the screen still shows the normal spelling. Whole words only.
const BN_SAY: Array<[written: string, said: string]> = [
  ["স্বাগতম", "স্বাগোতম"], // shagotom, not shagtom
  ["ঝাল", "ঝাল্"], // jhal, not jhalo
];
const BN_LETTER = "ঀ-৿";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (w: string) => new RegExp(`(?<![${BN_LETTER}])${escapeRe(w)}(?![${BN_LETTER}])`, "g");
// an English-letter word ("Sholo"), whatever its capitals
const wholeLatinWord = (w: string) => new RegExp(`(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`, "gi");
type SayRule = { to: RegExp; said: string; back: RegExp; written: string };
const rule = (written: string, said: string): SayRule => ({
  to: /[ঀ-৿]/.test(written) ? wholeWord(written) : wholeLatinWord(written),
  said,
  back: wholeWord(said),
  written,
});
const BN_SAY_RE: SayRule[] = BN_SAY.map(([written, said]) => rule(written, said));

// learned pronunciations (Cortex for every restaurant, Settings → AI Waiter for this one): "ষোল" → "শোলো" —
// applied before the built-ins, longer words first ("sholo aana" before "sholo")
let LEARNED: SayRule[] = [];
export function setPronunciations(list: Array<{ word?: string; spoken?: string }> | null | undefined): void {
  LEARNED = (list ?? [])
    .filter((x): x is { word: string; spoken: string } => !!x?.word?.trim() && !!x?.spoken?.trim())
    .sort((a, b) => b.word.length - a.word.length)
    .map((x) => rule(x.word.trim(), x.spoken.trim()));
}

export function forSpeech(text: string): string {
  return [...LEARNED, ...BN_SAY_RE].reduce((t, r) => t.replace(r.to, r.said), text);
}

export function fromSpeech(word: string): string {
  return [...LEARNED, ...BN_SAY_RE].reduce((t, r) => t.replace(r.back, r.written), word);
}
