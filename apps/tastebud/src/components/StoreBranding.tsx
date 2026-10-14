// apps/tastebud/src/components/StoreBranding.tsx
// The restaurant's own look in the browser (Settings → Branding / AI Waiter): the tab says "Burger House · Order online"
// (or "· Dine-in") with the restaurant's icon (its favicon, else its logo, else Qravy's), and the AI waiter speaks in
// the voice the owner chose. storefront-host puts the same title and icon into the page before it loads (link previews
// in WhatsApp / Facebook); this keeps them right as the guest moves around.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTenant } from '../api/storefront';
import { isDineInPath, storeSubFromPath } from '../utils/table';
import { getTTS, setPronunciations } from '../state/tts';
import { setPriceDigits } from '../utils/ui-lang';

// Azure's Bangladeshi Bangla voices — they read English too
export const VOICES = { female: 'bn-BD-NabanitaNeural', male: 'bn-BD-PradeepNeural' } as const;

function setIcon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.removeAttribute('type'); // the default is an SVG; a restaurant's icon is usually a PNG
    link.href = href;
  }
}

export default function StoreBranding() {
  const { pathname } = useLocation();
  const sub = /^\/(demo|voice-test)(\/|$)/.test(pathname) ? null : storeSubFromPath(pathname);
  // the same tenant info every page uses (one request, shared)
  const { data } = useQuery({
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
  const t = data as
    | { name?: string; logoUrl?: string | null; faviconUrl?: string | null; waiter?: { voice?: string }; pronunciations?: Array<{ word: string; spoken: string }>; priceDigits?: string }
    | null
    | undefined;
  const dineIn = isDineInPath(pathname);
  // prices in the restaurant's digits (৳২৫০ / ৳250) — set while rendering, before the pages below show any price
  setPriceDigits(t?.priceDigits);

  useEffect(() => {
    if (!t?.name) return;
    document.title = `${t.name} · ${dineIn ? 'Dine-in' : 'Order online'}`;
    setIcon(t.faviconUrl || t.logoUrl || '/qravy-icon.png');
  }, [t?.name, t?.faviconUrl, t?.logoUrl, dineIn]);

  useEffect(() => {
    if (!t) return;
    // the words this restaurant (and Qravy) taught the voice to say right
    setPronunciations(t.pronunciations);
    const voice = t.waiter?.voice === 'female' ? VOICES.female : VOICES.male;
    try {
      const tts = getTTS();
      if (tts.getVoice() !== voice) tts.setVoice(voice);
    } catch {
      /* speech not available here */
    }
  }, [t]);

  return null;
}
