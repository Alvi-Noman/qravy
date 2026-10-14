// apps/tastebud/src/utils/guestMessages.ts
// The restaurant's own words for what guests see (dashboard: Settings → Guest messages): the intro, the thank-you
// after a dine-in / delivery / pickup order, and the waiter-call confirmation — in Bangla and English. A message they
// haven't written uses the default. Placeholders: {restaurant} {waiter} {name} {table} {order}.
export type GuestMessageKey =
  | 'welcome'
  | 'dineInTitle'
  | 'dineInBody'
  | 'deliveryTitle'
  | 'deliveryBody'
  | 'pickupTitle'
  | 'pickupBody'
  | 'waiterCall';

export type GuestMessages = Partial<Record<GuestMessageKey, { bn?: string; en?: string }>>;
export type MessageVars = Partial<Record<'restaurant' | 'waiter' | 'name' | 'table' | 'order', string | number | null | undefined>>;

/** Puts the values in; a placeholder with no value goes, with the punctuation it leaves behind ("Thank you, !" → "Thank you!"). */
export function fillMessage(template: string, vars: MessageVars): string {
  return template
    .replace(/\{(restaurant|waiter|name|table|order)\}/g, (_m, k: keyof MessageVars) => {
      const v = vars[k];
      return v === null || v === undefined || v === '' ? '' : String(v);
    })
    .replace(/\s*,\s*([!।.?])/g, '$1') // "Thank you, !" → "Thank you!"
    .replace(/\s*,\s*$/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The restaurant's own text for this message in this language, filled in — or null for the default. */
export function ownMessage(messages: GuestMessages | null | undefined, key: GuestMessageKey, lang: 'bn' | 'en', vars: MessageVars): string | null {
  const t = messages?.[key]?.[lang]?.trim();
  if (!t) return null;
  const filled = fillMessage(t, vars);
  return filled || null;
}

