// services/auth-service/src/utils/pronounce.ts
// "Say it like" typed in English letters, the way Bangladeshis type Bangla ("sholo", "kacchi", "borhani") → the Bangla
// spelling the Bangla voice reads exactly that way ("শোলো", "কাচ্চি", "বোর্হানি"). Every letter typed is said: a vowel
// is written out (so "sholo" ends in "lo", not "shol"), a consonant with no vowel after it is silent-vowelled (্).
//   t / d / n / r / sh → ত দ ন র শ;  T / D / N / R / Sh → ট ড ণ ড় ষ  (capitals for the hard sounds)
// Already-Bangla input is kept as it is.

const BN = /[ঀ-৿]/;

// longest first; case matters only where Bangla has two sounds
const CONS: Array<[string, string]> = [
  ['chh', 'ছ'], ['Sh', 'ষ'], ['Th', 'ঠ'], ['Dh', 'ঢ'], ['Rh', 'ঢ়'],
  ['kh', 'খ'], ['gh', 'ঘ'], ['ch', 'চ'], ['jh', 'ঝ'], ['th', 'থ'], ['dh', 'ধ'], ['ph', 'ফ'], ['bh', 'ভ'], ['sh', 'শ'],
  ['k', 'ক'], ['g', 'গ'], ['c', 'চ'], ['j', 'জ'], ['T', 'ট'], ['t', 'ত'], ['D', 'ড'], ['d', 'দ'], ['N', 'ণ'], ['n', 'ন'],
  ['p', 'প'], ['f', 'ফ'], ['b', 'ব'], ['v', 'ভ'], ['m', 'ম'], ['z', 'জ'], ['R', 'ড়'], ['r', 'র'], ['l', 'ল'],
  ['s', 'স'], ['h', 'হ'], ['q', 'ক'], ['x', 'ক্স'],
];
// [typed, after a consonant, on its own]
const VOWELS: Array<[string, string, string]> = [
  ['aa', 'া', 'আ'], ['ee', 'ী', 'ঈ'], ['ii', 'ী', 'ঈ'], ['ie', 'ী', 'ঈ'], ['oo', 'ু', 'উ'], ['oi', 'ৈ', 'ঐ'],
  ['ou', 'ৌ', 'ঔ'], ['ow', 'ৌ', 'ঔ'], ['a', 'া', 'আ'], ['i', 'ি', 'ই'], ['I', 'ী', 'ঈ'], ['u', 'ু', 'উ'],
  ['U', 'ূ', 'ঊ'], ['e', 'ে', 'এ'], ['o', 'ো', 'ও'], ['O', 'ো', 'ও'],
];
const HASANT = '্';

/** One word typed in English letters → its Bangla pronunciation spelling. */
function word(w: string): string {
  // case matters only for the hard sounds (T D N R Sh Th Dh Rh); anything else is read in lower case
  const s = w.replace(/[A-Z]/g, (ch, i: number) => (/^(Sh|Th|Dh|Rh)/.test(w.slice(i)) || 'TDNRIUO'.includes(ch) ? ch : ch.toLowerCase()));
  let out = '';
  let afterCons = false; // the last thing written was a consonant still waiting for its vowel
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const v = VOWELS.find(([k]) => rest.startsWith(k));
    if (v) {
      out += afterCons ? v[1] : v[2];
      afterCons = false;
      i += v[0].length;
      continue;
    }
    // "ng": ঙ before a vowel (bangali → বাঙালি), ং otherwise (rong → রং)
    if (rest.startsWith('ng')) {
      const next = s.slice(i + 2);
      if (VOWELS.some(([k]) => next.startsWith(k))) {
        if (afterCons) out += HASANT;
        out += 'ঙ';
        afterCons = true;
      } else {
        if (afterCons) out += HASANT;
        out += 'ং';
        afterCons = false;
      }
      i += 2;
      continue;
    }
    // y / w: after a consonant they bend it (byapar → ব্যাপার, swad → স্বাদ); between vowels / at the start, য় / ও
    if (rest[0] === 'y' || rest[0] === 'w') {
      if (afterCons) {
        out += HASANT + (rest[0] === 'y' ? 'য' : 'ব');
        afterCons = true;
      } else {
        out += rest[0] === 'y' ? 'য়' : 'ও';
        afterCons = rest[0] === 'y';
      }
      i += 1;
      continue;
    }
    const c = CONS.find(([k]) => rest.startsWith(k));
    if (c) {
      if (afterCons) out += HASANT; // two consonants together: a conjunct (kacchi → কাচ্চি)
      out += c[1];
      afterCons = true;
      i += c[0].length;
      continue;
    }
    i += 1; // anything else (punctuation inside a word) is dropped
  }
  if (afterCons) out += HASANT; // ends on a consonant: no vowel after it (shol → শোল্)
  return out;
}

/** "Say it like" → what the voice reads. Bangla input stays as it is; English letters are spelled out word by word. */
export function toSpoken(sayAs: string): string {
  const t = String(sayAs ?? '').trim().replace(/\s+/g, ' ');
  if (!t || BN.test(t)) return t;
  return t
    .split(' ')
    .map((w) => word(w.replace(/[^A-Za-z-]/g, '')).replace(/-/g, ''))
    .filter(Boolean)
    .join(' ');
}

export type Pronunciation = { word: string; sayAs: string; spoken: string };

/** Cleans a list from a form: trimmed, spoken form worked out, one entry per word (the last one wins). */
export function cleanList(list: Array<{ word?: unknown; sayAs?: unknown }>): Pronunciation[] {
  const byWord = new Map<string, Pronunciation>();
  for (const x of list) {
    const word = String(x.word ?? '').trim().replace(/\s+/g, ' ');
    const sayAs = String(x.sayAs ?? '').trim().replace(/\s+/g, ' ');
    const spoken = toSpoken(sayAs);
    if (word && spoken) byWord.set(word.toLowerCase(), { word, sayAs, spoken });
  }
  return [...byWord.values()];
}
