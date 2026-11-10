// apps/tastebud/src/pwa/AppHead.tsx
// On a restaurant's pages: the tags that make its online shop installable — the manifest (Android), the square icon
// and the app title (iPhone). storefront-host writes the same into the page before it loads; this keeps them right in
// development (/t/<sub>) and as the guest moves between branches. Restaurants that don't sell online get none.
import { useEffect } from 'react';
import { appIconHref, manifestHref, siteBase } from './pwa';

const RESERVED = new Set(['dine-in', 'online', 'menu', 'checkout', 'order', 'confirmation', 'app', 'mic-test', 'suggest-test', 'demo', 'voice-test']);

/** The branch in the address: /t/<sub>/<branch>/… (development) or /<branch>/… (the restaurant's own address). */
export function branchOfPath(pathname: string): string | null {
  const store = typeof window !== 'undefined' ? (window as any).__STORE__ : undefined;
  if (store?.branch) return String(store.branch);
  const segs = pathname.split('/').filter(Boolean);
  const first = segs[0] === 't' ? segs[2] : segs[0];
  return first && !RESERVED.has(first) && !/^\d/.test(first) ? decodeURIComponent(first) : null;
}

function setTag(selector: string, make: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = make();
    document.head.appendChild(el);
  }
  if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
}

export function useAppHead(sub: string | null, pathname: string, info: { name?: string; channels?: { online?: boolean } } | null | undefined) {
  const online = info?.channels?.online !== false;
  const base = siteBase(pathname);
  const branch = branchOfPath(pathname);
  useEffect(() => {
    if (!sub || !info?.name) return;
    const manifest = document.head.querySelector('link[rel="manifest"]');
    if (!online) {
      manifest?.remove(); // (no app for a restaurant that doesn't sell online)
      return;
    }
    const link = (rel: string) => () => {
      const l = document.createElement('link');
      l.rel = rel;
      return l;
    };
    const meta = (name: string) => () => {
      const m = document.createElement('meta');
      m.name = name;
      return m;
    };
    setTag('link[rel="manifest"]', link('manifest'), 'href', manifestHref(sub, base, branch));
    setTag('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', appIconHref(sub, 180));
    setTag('meta[name="apple-mobile-web-app-capable"]', meta('apple-mobile-web-app-capable'), 'content', 'yes');
    setTag('meta[name="mobile-web-app-capable"]', meta('mobile-web-app-capable'), 'content', 'yes');
    setTag('meta[name="apple-mobile-web-app-title"]', meta('apple-mobile-web-app-title'), 'content', info.name);
  }, [sub, base, branch, online, info?.name]);
}
