// apps/rider/src/install.ts — putting the rider app on the rider's home screen, the same way guests install a
// restaurant's app (apps/tastebud/src/pwa): Android with Chrome's own install box, iPhone with Safari's "Add to Home
// Screen". The rider installs from their own link (/r/<link>), and the app opens there — signed in — because the
// manifest names no start page (an iPhone's home-screen app doesn't share Safari's saved data, so it must start on
// the link itself).
import { useSyncExternalStore } from 'react';

export type Phone = {
  os: 'android' | 'ios' | 'desktop';
  /** inside another app's built-in browser (WhatsApp, Facebook…) — installing can't happen there */
  inApp: boolean;
  /** iPhone: Safari / Chrome can add to the home screen; other browsers can't */
  iosBrowser: 'safari' | 'chrome' | 'other' | null;
  /** running as the installed app right now */
  standalone: boolean;
};

/** What the phone is, from what the browser says about itself (the same rules as the guest site's). */
export function phoneOf(ua: string, opts: { touchMac?: boolean; standalone?: boolean } = {}): Phone {
  const ios = /iPhone|iPod|iPad/i.test(ua) || (!!opts.touchMac && /Macintosh/i.test(ua));
  const android = !ios && /Android/i.test(ua);
  const inApp = /WhatsApp|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|Snapchat|TikTok/i.test(ua) || (android && /; wv\)/.test(ua));
  const iosBrowser: Phone['iosBrowser'] = !ios ? null : /CriOS/i.test(ua) ? 'chrome' : /FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua) ? 'other' : 'safari';
  return { os: ios ? 'ios' : android ? 'android' : 'desktop', inApp, iosBrowser, standalone: !!opts.standalone };
}

export function thisPhone(): Phone {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return phoneOf(navigator.userAgent, { touchMac: navigator.maxTouchPoints > 1, standalone });
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let offer: InstallEvent | null = null;
let installedNow = false;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

/** Called once at startup: Chrome offers installing early — kept for the page that asks. */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallEvent;
    ping();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    offer = null;
    ping();
  });
}

export function useInstall() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => `${offer ? 1 : 0}${installedNow ? 1 : 0}`,
    () => '00',
  );
  return { canPrompt: s[0] === '1', installedNow: s[1] === '1' };
}

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

/** Android: open this page in Chrome, from another app's built-in browser (WhatsApp…). */
export function chromeIntent(href = location.href): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
