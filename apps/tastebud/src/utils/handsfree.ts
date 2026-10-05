// apps/tastebud/src/utils/handsfree.ts
// Hands-free conversation — shared by the home screen and the mic bar in the pop-ups.
// The SERVER hears when the guest has finished speaking (Silero VAD + a voice match, see
// services/ai-waiter-service/endpointer.py and voiceprint.py): no second tap to send, and after the waiter ASKS
// something the mic reopens for a short listen window (nobody answers → it closes quietly).

/** After the waiter's question, the mic stays open this long for the answer. */
export const FOLLOW_UP_LISTEN_MS = 6_000;
/** Listen windows in a row without a tap — then the guest taps again (a noisy room can't keep the mic open). */
export const MAX_FOLLOW_UPS = 3;
/** Audio held while the connection opens (the first syllable!) — ~5 s of 20 ms frames. */
export const PENDING_AUDIO_MAX = 250;

/** Off unless turned on (`qravy:handsfree` = '1'): the guest talks only while HOLDING the orb / mic — the mic never
 *  reopens by itself. */
export function handsFreeOn(): boolean {
  try {
    return localStorage.getItem('qravy:handsfree') === '1';
  } catch {
    return false;
  }
}

export const isQuestion = (t: string) => /[?？]\s*$/.test((t || '').trim());

/** Should the mic reopen after this reply? Never after "didn't catch that" (noise could keep reopening it), after
 *  the order is placed, when the menu opens, or past MAX_FOLLOW_UPS in a row. */
export function wantsFollowUp(replyText: string, meta: any, followUpsSoFar: number): boolean {
  const guards: string[] = Array.isArray(meta?.guards) ? meta.guards : [];
  const unclear = guards.some((g) => ['unclear', 'no-speech', 'no-audio', 'not_understood'].includes(g));
  return (
    handsFreeOn() &&
    isQuestion(replyText) &&
    !unclear &&
    followUpsSoFar < MAX_FOLLOW_UPS &&
    !meta?.decision?.openMenu &&
    !meta?.decision?.orderPlaced
  );
}

export type ChooseOption = { label: string; say: string; price?: number };

/** A dish the waiter is holding until the guest picks its size / required choices (meta.decision.pickOptions). */
export type PickOption = {
  itemId: string;
  name: string;
  quantity: number;
  /** chosen so far (by voice or tap) */
  variant: string;
  choices: string[];
  /** still needed: 'size' and/or required group names */
  missing: string[];
  sizes: { name: string; price?: number }[];
  groups: { name: string; min: number; max: number; options: { name: string; price: number }[] }[];
  /** the size-up, as a hint on the bigger sizes ("আরও 4 পিস, মাত্র +৳170 · সবচেয়ে সাশ্রয়ী") — never asked */
  sizeHints: Record<string, string>;
};

export function pickOptionsOf(meta: any): PickOption[] {
  const list = Array.isArray(meta?.decision?.pickOptions) ? meta.decision.pickOptions : [];
  return list
    .filter((p: any) => p && typeof p.itemId === 'string' && typeof p.name === 'string')
    .map((p: any) => ({
      itemId: p.itemId,
      name: p.name,
      quantity: Number(p.quantity) || 1,
      variant: String(p.variant || ''),
      choices: Array.isArray(p.choices) ? p.choices.map(String) : [],
      missing: Array.isArray(p.missing) ? p.missing.map(String) : [],
      sizes: Array.isArray(p.sizes) ? p.sizes.filter((s: any) => s?.name) : [],
      groups: Array.isArray(p.groups) ? p.groups.filter((g: any) => g && Array.isArray(g.options)) : [],
      sizeHints: p.sizeHints && typeof p.sizeHints === 'object' ? p.sizeHints : {},
    }));
}

/** The waiter's "which one?" answers as buttons (meta.decision.chooseOptions). */
export function chooseOptionsOf(meta: any): ChooseOption[] {
  const opts = Array.isArray(meta?.decision?.chooseOptions) ? meta.decision.chooseOptions : [];
  return opts
    .filter((o: any) => o && typeof o.say === 'string' && o.say.trim() && typeof o.label === 'string')
    .slice(0, 8)
    .map((o: any) => ({ label: String(o.label), say: String(o.say), price: typeof o.price === 'number' ? o.price : undefined }));
}
