// apps/tastebud/src/themes/ember/guestFilter.ts
// What the guest told Pixie they can't or won't eat ("I don't eat beef", "nut allergy") — the waiter sends it with
// each reply (meta.guestFilter: diet / allergy codes, ingredient words, and the dishes that rules out). The menu shows
// it as chips on top and hides those dishes; one tap shows everything again. Kept for this tab (sessionStorage).
import { useEffect, useState } from 'react';
import type { Lang } from './ui';

export type GuestFilter = { diet: string[]; allergies: string[]; avoid: string[]; hide: string[] };

const DIET: Record<string, [string, string]> = {
  vegetarian: ['নিরামিষ', 'Vegetarian'],
  vegan: ['ভেগান', 'Vegan'],
  no_beef: ['বিফ ছাড়া', 'No beef'],
  no_pork: ['পর্ক ছাড়া', 'No pork'],
  pescatarian: ['মাংস ছাড়া (মাছ চলবে)', 'No meat (fish is fine)'],
  halal: ['হালাল', 'Halal'],
};
const ALLERGY: Record<string, [string, string]> = {
  nuts: ['বাদাম ছাড়া', 'No nuts'],
  shellfish: ['চিংড়ি-কাঁকড়া ছাড়া', 'No shellfish'],
  fish: ['মাছ ছাড়া', 'No fish'],
  egg: ['ডিম ছাড়া', 'No egg'],
  dairy: ['দুধ ছাড়া', 'No dairy'],
  gluten: ['গ্লুটেন ছাড়া', 'No gluten'],
  mushroom: ['মাশরুম ছাড়া', 'No mushroom'],
  sesame: ['তিল ছাড়া', 'No sesame'],
  soy: ['সয়া ছাড়া', 'No soy'],
};

/** The chips' words, in the guest's language. */
export function filterLabels(f: GuestFilter, lang: Lang): string[] {
  const pick = (pair?: [string, string]) => (pair ? (lang === 'en' ? pair[1] : pair[0]) : '');
  return [
    ...f.diet.map((d) => pick(DIET[d])),
    ...f.allergies.map((a) => pick(ALLERGY[a])),
    ...f.avoid.map((w) => (lang === 'en' ? `No ${w}` : `${w} ছাড়া`)),
  ].filter(Boolean);
}

const asFilter = (v: any): GuestFilter | null =>
  v && typeof v === 'object'
    ? {
        diet: Array.isArray(v.diet) ? v.diet.map(String) : [],
        allergies: Array.isArray(v.allergies) ? v.allergies.map(String) : [],
        avoid: Array.isArray(v.avoid) ? v.avoid.map(String) : [],
        hide: Array.isArray(v.hide) ? v.hide.map(String) : [],
      }
    : null;

export function useGuestFilter(sub: string, lastMeta: unknown) {
  const key = `qravy:ember:filter:${sub}`;
  const [state, setState] = useState<{ f: GuestFilter | null; on: boolean }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      return { f: asFilter(saved?.f), on: saved?.on !== false };
    } catch {
      return { f: null, on: true };
    }
  });
  const fromReply = asFilter((lastMeta as any)?.guestFilter);
  const sig = fromReply ? JSON.stringify(fromReply) : '';
  useEffect(() => {
    if (!fromReply) return;
    // a new filter (they said something new) comes on again
    setState((s) => ({ f: fromReply, on: s.f && JSON.stringify(s.f) === sig ? s.on : true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage blocked */
    }
  }, [key, state]);
  return {
    filter: state.f,
    on: state.on && !!state.f,
    hidden: new Set(state.on && state.f ? state.f.hide : []),
    setOn: (on: boolean) => setState((s) => ({ ...s, on })),
  };
}
