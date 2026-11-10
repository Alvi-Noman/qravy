// apps/tastebud/src/themes/theme.ts
// Which look the guest site has (admin → Digital Menu → Themes). Every restaurant has one theme:
//   'ember' — dark, voice-first: the orb at the bottom, ghost upsells in the order (the default for new restaurants)
//   'petal' — the original light look (restaurants from before themes keep it until they switch)
// The waiter, the cart, ordering and checkout rules are the same in both — a theme is only how they look.
//
// PREVIEW: the admin's theme preview opens the site with "?theme=ember" (or petal). That choice is kept for this tab
// only (sessionStorage), so the preview stays on its theme while the owner clicks around — real guests never see it.
// "?theme=live" drops it.
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTenant } from '../api/storefront';
import { storeSubFromPath } from '../utils/table';

export type ThemeId = 'petal' | 'ember';
export const THEMES: ThemeId[] = ['ember', 'petal'];

const asTheme = (v: unknown): ThemeId | null => (v === 'petal' || v === 'ember' ? v : null);
const previewKey = (sub: string | null) => `qravy:theme-preview:${sub || 'anon'}`;

/** The theme this tab is previewing (from "?theme=", remembered for the tab), or null. */
export function previewTheme(sub: string | null): ThemeId | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q === 'live') {
      sessionStorage.removeItem(previewKey(sub));
      return null;
    }
    const fromUrl = asTheme(q);
    if (fromUrl) {
      sessionStorage.setItem(previewKey(sub), fromUrl);
      return fromUrl;
    }
    return asTheme(sessionStorage.getItem(previewKey(sub)));
  } catch {
    return asTheme(new URLSearchParams(window.location.search).get('theme'));
  }
}

/** The restaurant's theme — null while its info is loading (render nothing yet, never the wrong look). */
export function themeOf(info: { theme?: unknown } | null | undefined): ThemeId | null {
  if (!info) return null;
  return asTheme(info.theme) ?? 'petal'; // (an API from before themes sends none → the original look)
}

export function useStoreTheme(): ThemeId | null {
  const { pathname } = useLocation();
  const sub = storeSubFromPath(pathname);
  // the same cached request every page makes (useTenantInfo) — here we also need to know when it has failed
  const { data, isFetched } = useQuery({
    queryKey: ['tenantInfo', sub],
    enabled: Boolean(sub),
    queryFn: async () => {
      const storeTenant = (typeof window !== 'undefined' ? (window as any).__STORE__?.tenant : undefined) ?? null;
      if (storeTenant) return storeTenant;
      return sub ? await getTenant(sub) : null;
    },
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const preview = previewTheme(sub);
  if (preview) return preview;
  if (!sub) return 'petal';
  // unknown restaurant / API down: the original pages (they show their own "not found" / errors)
  return themeOf(data) ?? (isFetched ? 'petal' : null);
}
