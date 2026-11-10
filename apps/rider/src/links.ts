// apps/rider/src/links.ts — the rider's links, kept on this phone. One rider can ride for several restaurants: each
// gave them a link (or a QR code); the app remembers every one, opens the last used, and lets them switch.
export type SavedLink = { token: string; restaurant: string; rider: string; at: number };

const KEY = 'qravy:rider:links';

export function savedLinks(): SavedLink[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as SavedLink[];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.token === 'string').sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

export function saveLink(l: Omit<SavedLink, 'at'>) {
  try {
    const rest = savedLinks().filter((x) => x.token !== l.token);
    localStorage.setItem(KEY, JSON.stringify([{ ...l, at: Date.now() }, ...rest].slice(0, 10)));
  } catch {
    /* storage blocked */
  }
}

export function forgetLink(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(savedLinks().filter((x) => x.token !== token)));
  } catch {
    /* storage blocked */
  }
}

/** The link token from whatever the rider pasted or scanned: a full link (…/r/<token>, or the older …/rider/<token>)
 *  or the token itself. null = not a rider link. */
export function tokenFrom(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/(?:r|rider)\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : null;
}
