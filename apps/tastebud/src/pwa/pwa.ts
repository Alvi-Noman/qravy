// apps/tastebud/src/pwa/pwa.ts
// The restaurant's own app: its online shop added to the guest's home screen (a PWA) — on Android with Chrome's own
// install box, on iPhone with Safari's "Add to Home Screen". This file knows the phone and browser, keeps Chrome's
// install offer (it comes once, early — before any page asks for it), and says where the app lives.
// The app itself is described by the server (auth-service routes/appRoutes.ts): it always opens the online shop.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { track } from '../utils/track';

/* ------------------------------------------------------------------ the phone and browser */

export type Phone = {
  os: 'android' | 'ios' | 'desktop';
  /** inside another app's built-in browser — installing can't happen there */
  inApp: 'whatsapp' | 'facebook' | 'instagram' | 'other' | null;
  /** iPhone: Safari (can add to the home screen), Chrome (newer iPhones can too), or another browser */
  iosBrowser: 'safari' | 'chrome' | 'other' | null;
  /** running as the installed app right now */
  standalone: boolean;
};

/** What the phone is, from what the browser says about itself (pure — unit-tested). */
export function phoneOf(ua: string, opts: { touchMac?: boolean; standalone?: boolean } = {}): Phone {
  const ios = /iPhone|iPod|iPad/i.test(ua) || (!!opts.touchMac && /Macintosh/i.test(ua));
  const android = !ios && /Android/i.test(ua);
  const inApp: Phone['inApp'] = /WhatsApp/i.test(ua)
    ? 'whatsapp'
    : /FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)
    ? 'facebook'
    : /Instagram/i.test(ua)
    ? 'instagram'
    : android && /; wv\)/.test(ua)
    ? 'other' // an Android app's built-in browser (WhatsApp's shows as this)
    : /Line\/|Snapchat|Twitter|TikTok/i.test(ua)
    ? 'other'
    : null;
  const iosBrowser: Phone['iosBrowser'] = !ios ? null : /CriOS/i.test(ua) ? 'chrome' : /FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua) ? 'other' : 'safari';
  return { os: ios ? 'ios' : android ? 'android' : 'desktop', inApp, iosBrowser, standalone: !!opts.standalone };
}

export function thisPhone(): Phone {
  if (typeof window === 'undefined') return { os: 'desktop', inApp: null, iosBrowser: null, standalone: false };
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return phoneOf(navigator.userAgent, { touchMac: navigator.maxTouchPoints > 1, standalone });
}

/* ------------------------------------------------------------------ Chrome's install offer */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let offer: InstallEvent | null = null;
let installedNow = false;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

/** Called once at startup (main.tsx): Chrome offers installing early — kept for the page that asks. */
export function initPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // (we show our own button, at the right moment — not Chrome's banner)
    offer = e as InstallEvent;
    ping();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    offer = null;
    try {
      localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
    track('app_installed', { data: { kind: 'android' } });
    ping();
  });
  // opened from the home screen → counted once per visit
  try {
    const p = thisPhone();
    if (p.standalone && /[?&]source=homescreen\b/.test(location.search) && !sessionStorage.getItem('qravy:app:open')) {
      sessionStorage.setItem('qravy:app:open', '1');
      track('app_open');
    }
  } catch {
    /* storage blocked */
  }
  registerWorker();
}

const INSTALLED_KEY = 'qravy:app:installed';

/** Chrome's offer and what became of it, live. `canPrompt`: one tap brings up Android's install box. */
export function useInstall() {
  const state = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => `${offer ? 1 : 0}${installedNow ? 1 : 0}`,
    () => '00',
  );
  return { canPrompt: state[0] === '1', installedNow: state[1] === '1' };
}

/** Bring up Android's install box. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!offer) return 'unavailable';
  const e = offer;
  offer = null;
  ping();
  try {
    await e.prompt();
    return (await e.userChoice).outcome;
  } catch {
    return 'unavailable';
  }
}

/** Installed on this phone before (Android tells us at install time; iPhones never do). */
export function installedBefore(): boolean {
  try {
    return !!localStorage.getItem(INSTALLED_KEY);
  } catch {
    return false;
  }
}

/** Whether Android reports this restaurant's app as installed (a moment after load; false where it can't tell). */
export function useInstalledApp(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    if (!nav.getInstalledRelatedApps) return;
    nav
      .getInstalledRelatedApps()
      .then((list) => setYes(Array.isArray(list) && list.length > 0))
      .catch(() => {});
  }, []);
  return yes;
}

/* ------------------------------------------------------------------ where the app lives */

/** Where this restaurant's site lives on this address: "/t/<sub>" in development, "" on its own address. */
export function siteBase(pathname: string): string {
  const m = /^\/t\/([^/?#]+)/.exec(pathname);
  return m ? `/t/${m[1]}` : '';
}

/** The online shop (what the app opens), on this address. */
export const shopHref = (base: string, branch?: string | null) => `${base}/${branch ? `${branch}/` : ''}`;

/** The install page (what the QR card and the shared link open). */
export const installHref = (base: string, branch?: string | null) => `${base}/${branch ? `${branch}/` : ''}app`;

/** The manifest the server writes for this restaurant (same address — the phone requires it). */
export const manifestHref = (sub: string, base: string, branch?: string | null) =>
  `/api/v1/public/app/${encodeURIComponent(sub)}/manifest.webmanifest?base=${encodeURIComponent(base)}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`;

export const appIconHref = (sub: string, size: 180 | 192 | 512) => `/api/v1/public/app/${encodeURIComponent(sub)}/icon-${size}.png`;

/** Android: open this page in Chrome, from another app's built-in browser (WhatsApp, Facebook…). */
export function chromeIntent(href = typeof location !== 'undefined' ? location.href : ''): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

/* ------------------------------------------------------------------ the offline helper */

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  // only on a restaurant's pages, and not in the dev server's own tooling
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
