// apps/tastebud/src/utils/waiter-lang.ts
// The language the virtual waiter listens and replies in.
//   1) the guest's own choice (the top-right switch, or ?lang=bn|en in the link), remembered per restaurant
//   2) otherwise the restaurant's default (admin → Settings → Localization)
//   3) otherwise Bangla
// The effective language is mirrored to window.__WAITER_LANG__, the "qravy:lang" event and localStorage
// "qravy:lang", which the mic bar, cart and checkout read (utils/ui-lang.ts).
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTenant } from '../api/storefront';

export type WaiterLang = 'bn' | 'en';

const CHOICE_EVENT = 'qravy:lang-choice';
const choiceKey = (sub?: string | null) => `qravy:lang:${sub || 'anon'}`;

const asLang = (v: unknown): WaiterLang | null => (v === 'bn' || v === 'en' ? v : null);

function readChoice(sub?: string | null): WaiterLang | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = asLang(new URLSearchParams(window.location.search).get('lang'));
  if (fromUrl) {
    try {
      localStorage.setItem(choiceKey(sub), fromUrl);
    } catch {
      /* storage blocked */
    }
    return fromUrl;
  }
  try {
    return asLang(localStorage.getItem(choiceKey(sub)));
  } catch {
    return null;
  }
}

function broadcast(lang: WaiterLang) {
  if (typeof window === 'undefined') return;
  (window as any).__WAITER_LANG__ = lang;
  try {
    localStorage.setItem('qravy:lang', lang);
  } catch {
    /* storage blocked */
  }
  try {
    document.documentElement.setAttribute('lang', lang);
  } catch {
    /* no document */
  }
  try {
    window.dispatchEvent(new CustomEvent('qravy:lang', { detail: { lang } }));
  } catch {
    /* old browser */
  }
}

/** Restaurant default from the public tenant info (shares the DigitalMenu / order-mode cache). */
function useDefaultLang(sub?: string | null): WaiterLang | null {
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
  return asLang((data as any)?.waiterLanguage);
}

/** [effective language, set the guest's choice] */
export function useWaiterLang(sub?: string | null): [WaiterLang, (lang: WaiterLang) => void] {
  const fallback = useDefaultLang(sub);
  const [choice, setChoice] = useState<WaiterLang | null>(() => readChoice(sub));

  useEffect(() => {
    setChoice(readChoice(sub));
    // other screens using this hook (same page) follow the guest's switch
    const onChoice = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if ((d.sub || null) === (sub || null)) setChoice(asLang(d.lang));
    };
    window.addEventListener(CHOICE_EVENT, onChoice);
    return () => window.removeEventListener(CHOICE_EVENT, onChoice);
  }, [sub]);

  const lang: WaiterLang = choice ?? fallback ?? 'bn';

  useEffect(() => {
    broadcast(lang);
  }, [lang]);

  const setLang = useCallback(
    (next: WaiterLang) => {
      try {
        localStorage.setItem(choiceKey(sub), next);
      } catch {
        /* storage blocked */
      }
      setChoice(next);
      try {
        window.dispatchEvent(new CustomEvent(CHOICE_EVENT, { detail: { sub: sub || null, lang: next } }));
      } catch {
        /* old browser */
      }
    },
    [sub],
  );

  return [lang, setLang];
}
