// apps/tastebud/src/utils/ui-lang.ts
// The guest's chosen language (set on the waiter screen), for small bilingual UI labels.
export type UiLang = 'bn' | 'en';

export function uiLang(): UiLang {
  if (typeof window === 'undefined') return 'bn';
  const w = (window as any).__WAITER_LANG__;
  let v: string | null = typeof w === 'string' ? w : null;
  try {
    v = v || localStorage.getItem('qravy:lang');
  } catch {
    /* storage blocked */
  }
  return v === 'en' ? 'en' : 'bn';
}

/** The language hint for the voice socket: "bn" | "en" (auto → bn, the STT default). */
export function waiterLang(): 'bn' | 'en' {
  return uiLang();
}

export const tr = (lang: UiLang, bn: string, en: string) => (lang === 'bn' ? bn : en);

const BDT = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 });
export const money = (n: number) => `৳${BDT.format(Math.round(n * 100) / 100)}`;
