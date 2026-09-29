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

/** On unless the guest turned it off. */
export function handsFreeOn(): boolean {
  try {
    return localStorage.getItem('qravy:handsfree') !== '0';
  } catch {
    return true;
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

/** The waiter's "which one?" answers as buttons (meta.decision.chooseOptions). */
export function chooseOptionsOf(meta: any): ChooseOption[] {
  const opts = Array.isArray(meta?.decision?.chooseOptions) ? meta.decision.chooseOptions : [];
  return opts
    .filter((o: any) => o && typeof o.say === 'string' && o.say.trim() && typeof o.label === 'string')
    .slice(0, 8)
    .map((o: any) => ({ label: String(o.label), say: String(o.say), price: typeof o.price === 'number' ? o.price : undefined }));
}
