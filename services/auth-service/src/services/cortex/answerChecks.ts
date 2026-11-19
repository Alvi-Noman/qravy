// services/auth-service/src/services/cortex/answerChecks.ts
// Flags the AI waiter's answers that look wrong, for Cortex's "Flagged answers" page. Free: word patterns over the
// turns the waiter already stores (qravy.transcripts) — no AI calls. Each check reads one visit (a guest's turns until
// 30 minutes of quiet), so it can use what the guest did NEXT: pushed back, said it again, removed what was added.
//
// Severity:
//   bad    — the guest got a wrong / broken answer
//   check  — maybe wrong; worth a look
//   caught — the AI got it wrong and the waiter's safety net fixed it before the guest saw it (shows where the model
//            is weak; hidden by default)
import type { Document } from 'mongodb';

export type Severity = 'bad' | 'check' | 'caught';
export type Finding = { code: string; severity: Severity; label: string; detail?: string };

/** What each code means, for the page's filter chips. */
export const CHECKS: Record<string, { severity: Severity; label: string }> = {
  model_down: { severity: 'bad', label: 'AI was unavailable' },
  trouble_reply: { severity: 'bad', label: 'Said it was having trouble' },
  said_didnt_hear: { severity: 'bad', label: 'Said it didn’t hear — but it did' },
  not_understood: { severity: 'check', label: 'Told the guest it didn’t understand' },
  empty_reply: { severity: 'bad', label: 'Said nothing' },
  claimed_added: { severity: 'bad', label: 'Said it added — tray didn’t change' },
  claimed_changed: { severity: 'bad', label: 'Said it changed — tray didn’t change' },
  wrong_language: { severity: 'bad', label: 'Answered in the wrong language' },
  same_reply_twice: { severity: 'bad', label: 'Same answer twice in a row' },
  guest_pushed_back: { severity: 'bad', label: 'Guest said it was wrong' },
  guest_repeated: { severity: 'bad', label: 'Guest had to say it again' },
  guest_asked_again: { severity: 'check', label: 'Guest asked it to repeat' },
  removed_right_after: { severity: 'check', label: 'Added, then removed right after' },
  said_unavailable: { severity: 'check', label: 'Said a dish isn’t available' },
  long_reply: { severity: 'check', label: 'Very long answer' },
  caught: { severity: 'caught', label: 'AI was wrong, safety net fixed it' },
};

/** Safety-net tags (ai-waiter-service brain.py `guards`) that mean the model's own answer was wrong. */
const CAUGHT_GUARDS = new Set([
  'wrong_dish_corrected',
  'unavailable_mended',
  'false_added_claim_replaced',
  'false_change_claim_replaced',
  'false_confirm_claim_replaced',
  'added_but_said_unavailable',
  'kitchen_claim_fixed',
  'compare_answer_replaced',
  'claim_about_suggestions_cut',
  'odd_substitute_replaced',
  'reco_replaced',
  'model_pitch_removed',
  'packaged_praise_removed',
  'stayed_on_asked_dish',
  'quantity_as_said',
  'swap_kept_quantity',
  'offer_while_adding_fixed',
  'no_pitch_after_no',
  'info_answered_only',
]);

// Bangla has two spellings of য় (one code point, or য + nukta): NFC makes them one, so every pattern and text is NFC.
const N = (s: unknown) => String(s ?? '').normalize('NFC');
const rx = (src: string, flags = 'i') => new RegExp(N(src), flags);

const BN = /[ঀ-৿]/g;
const LATIN_WORD = /[A-Za-z]{2,}/g;

const TROUBLE = rx(String.raw`having a little trouble|একটু সমস্যা হচ্ছে`);
// ("বুঝতে পারিনি" to words that make no sense is the RIGHT answer — that's not_understood, a "check")
const DIDNT_HEAR = rx(String.raw`didn'?t catch|couldn'?t hear|শুনতে পাইনি|শুনতে পারিনি|শুনি নাই`);
// (the waiter's own words, brain.py _CLAIMS_ADDED / _CLAIMS_CHANGED — a sentence ending in "?" is an offer, not a claim)
const CLAIMS_ADDED = rx(
  String.raw`\badded\b|\bi'?ve added\b|in your (cart|order|tray)|(যোগ|যুক্ত|অ্যাড|এড) (করা|করে) (হয়েছে|হলো|হল|দেওয়া|দেয়া|দিলাম|দিয়েছি|নিলাম|নিয়েছি)|(যোগ|যুক্ত|অ্যাড|এড) (করলাম|করেছি|করে দিচ্ছি|হয়েছে|হলো)`
);
const CLAIMS_CHANGED = rx(
  String.raw`\b(removed|changed|updated|reduced|switched|swapped)\b|বাদ দিলাম|বাদ দিয়েছি|সরিয়ে দিলাম|কমিয়ে দিলাম|বদলে দিলাম|বদলে দিয়েছি|ঠিক করে দিলাম|বাদ (দেওয়া|দেয়া) (হলো|হয়েছে)|(সরানো|কমানো|বাতিল করা) (হলো|হয়েছে)|(সরিয়ে|কমিয়ে|বদলে) (দেওয়া|দেয়া) (হলো|হয়েছে)`
);
// the guest's NEXT words, telling the waiter it got it wrong (a bare "না" is everyday — "না, আর কিছু না" — so not alone)
const PUSHBACK = rx(
  String.raw`না না|ভুল|বললাম|বলেছি|বলছি তো|বলি নাই|বলিনি|চাই নাই|চাইনি|(এটা|ওটা|সেটা|এইটা|ঐটা) না(?![ঀ-৿])|বুঝেন নাই|বুঝেননি|বুঝলেন না|বুঝতেছেন না|বুঝতে পারছেন না|(কি|কী) বলেন|(কি|কী) বলতেছেন|\bno,? no\b|\bwrong\b|\bnot that\b|\bi said\b|\bi (didn'?t|did not) (say|ask|want|order)\b|\bi asked (for|about)\b|\bthat'?s not\b|\bnot what i\b|\bvul\b|\bbollam\b`
);
// brain.py _SAY_AGAIN: the guest didn't follow the answer
const SAY_AGAIN = rx(
  String.raw`(আবার|আরেকবার|আর একবার|আরেক বার)\s*(বলেন|বলুন|বলো|বল|বলবেন)|(কি|কী) বললেন|(কি|কী) বললা|\b(say (that|it) again|repeat (that|it|please)|come again|pardon|what did you say|abar bolen|abar bolo)\b`
);
const UNAVAILABLE = rx(
  String.raw`মেনুতে নেই|আমাদের (কাছে )?(এটা |এটি )?নেই|পাওয়া যাচ্ছে না|পাওয়া যাবে না|শেষ হয়ে গেছে|স্টকে নেই|\bnot on (the|our) menu\b|\b(don'?t|do not) have\b|\bsold out\b|\b(is|are)n'?t available\b|\bnot available\b|\bunavailable\b`
);
// short answers a guest naturally says twice ("হ্যাঁ" to two questions) — not a repeat
const ACKS = new Set(['হ্যাঁ', 'হ্যা', 'হা', 'জি', 'জ্বি', 'জী', 'না', 'আচ্ছা', 'ঠিক আছে', 'ওকে', 'ok', 'okay', 'yes', 'no', 'hmm', 'thanks', 'ধন্যবাদ'].map(N));

const LONG_REPLY = 450;

const guestWords = (d: Document) => N(d.text_norm || d.text).trim();
const words = (s: string) =>
  N(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
const claimSentences = (reply: string) =>
  (N(reply).match(/[^।.!?]+[।.!?]?/g) ?? []).filter((s) => s.trim() && !s.trim().endsWith('?'));

function similar(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  const jx = x.join(' ');
  const jy = y.join(' ');
  if (ACKS.has(jx) || ACKS.has(jy)) return false;
  if (jx === jy) return x.length >= 2 || jx.length >= 4;
  if (x.length < 2 || y.length < 2) return false;
  const sx = new Set(x);
  const sy = new Set(y);
  const inter = [...sx].filter((w) => sy.has(w)).length;
  return inter / (sx.size + sy.size - inter) >= 0.6;
}

/** The AI itself failed this turn (outage / "having a little trouble") — one finding, not a pile of echoes. */
const down = (d: Document) => !!d.ai?.meta?.fallback || TROUBLE.test(N(d.ai?.replyText));
const opsOf = (d: Document) => ((d.ai?.meta?.cartOps ?? []) as Document[]).filter((o) => o && o.op);
const nameKey = (s: unknown) => N(s).toLowerCase().trim();

function wrongLanguage(d: Document, reply: string): string | null {
  const lang = d.ai?.meta?.language;
  const bn = (reply.match(BN) ?? []).length;
  const latin = (reply.match(LATIN_WORD) ?? []).length;
  if (lang === 'bn' && bn === 0 && latin >= 3) return 'Guest spoke Bangla; the answer is in English';
  if (lang === 'en' && bn > 20 && bn > reply.length * 0.4) return 'Guest spoke English; the answer is in Bangla';
  return null;
}

/**
 * One visit's turns (oldest first) → what looks wrong in each turn's answer (same order; [] = nothing).
 * Only the waiter's answers are judged — a turn it couldn't hear (status "unheard") is a speech-to-text problem.
 */
export function checkVisit(turns: Document[]): Finding[][] {
  return turns.map((d, i) => {
    const out: Finding[] = [];
    const add = (code: string, detail?: string) => {
      const c = CHECKS[code];
      if (!out.some((f) => f.code === code)) out.push({ code, severity: c.severity, label: c.label, ...(detail ? { detail } : {}) });
    };
    if (d.status === 'unheard') return out;
    const meta = (d.ai?.meta ?? {}) as Document;
    const reply = N(d.ai?.replyText).trim();
    const guards = ((meta.guards ?? []) as unknown[]).map(String);
    const ops = opsOf(d);
    const next = turns.slice(i + 1).find((t) => t.status !== 'unheard');
    const prev = [...turns.slice(0, i)].reverse().find((t) => t.status !== 'unheard');

    if (meta.fallback) add('model_down');
    if (!reply) {
      if (!meta.fallback) add('empty_reply');
    } else {
      if (TROUBLE.test(reply)) {
        if (!meta.fallback) add('trouble_reply'); // (an outage is already "AI was unavailable")
      }
      else if (DIDNT_HEAR.test(reply) && guestWords(d)) add('said_didnt_hear', `It heard: “${guestWords(d)}”`);
      const sentences = claimSentences(reply);
      const changedTray = ops.length > 0 || !!meta.clearCart || !!meta.decision?.orderPlaced;
      if (!changedTray && sentences.some((s) => CLAIMS_ADDED.test(s))) add('claimed_added');
      else if (!changedTray && sentences.some((s) => CLAIMS_CHANGED.test(s))) add('claimed_changed');
      const lang = wrongLanguage(d, reply);
      if (lang) add('wrong_language', lang);
      if (prev && reply.length > 20 && N(prev.ai?.replyText).trim() === reply && !down(d) && !down(prev)) add('same_reply_twice');
      if (UNAVAILABLE.test(reply) && !guards.includes('missing_dish_said')) add('said_unavailable');
      if (reply.length > LONG_REPLY) add('long_reply', `${reply.length} characters`);
    }
    if (guards.includes('not_understood')) add('not_understood');
    if (guards.includes('missing_dish_said')) add('said_unavailable');
    const caught = guards.filter((g) => CAUGHT_GUARDS.has(g));
    if (caught.length) add('caught', caught.join(', '));

    // what the guest did next
    if (next) {
      const said = guestWords(next);
      if (PUSHBACK.test(said)) add('guest_pushed_back', `Next: “${said}”`);
      else if (SAY_AGAIN.test(said)) add('guest_asked_again', `Next: “${said}”`);
      // (after "having trouble — say it again?" the guest is SUPPOSED to repeat: the outage is the finding)
      else if (!down(d) && similar(guestWords(d), said)) add('guest_repeated', `Next: “${said}”`);
      const added = ops.filter((o) => o.op === 'add').map((o) => nameKey(o.name)).filter(Boolean);
      const soon = turns.slice(i + 1, i + 3);
      const removed = soon.flatMap(opsOf).filter((o) => o.op === 'remove' || (o.op === 'set' && Number(o.quantity) === 0));
      const undone = removed.find((o) => added.includes(nameKey(o.name)));
      if (undone) add('removed_right_after', String(undone.name));
    }
    return out;
  });
}
