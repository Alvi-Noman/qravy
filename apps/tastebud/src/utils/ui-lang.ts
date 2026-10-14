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

/* ------------------------------------------------------------------ prices */

// The digits prices are shown in — the restaurant's setting (a menu printed "৳ ২৫০" → Bangla), set by StoreBranding.
let digits: 'latin' | 'bn' = 'latin';
export function setPriceDigits(d: unknown): void {
  digits = d === 'bn' ? 'bn' : 'latin';
}

const BN = '০১২৩৪৫৬৭৮৯';
const BDT = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 });
/** 1250 → "1,250", or "১,২৫০" for a restaurant whose prices are in Bangla. */
export const priceNumber = (n: number): string => {
  const s = BDT.format(Math.round(n * 100) / 100);
  return digits === 'bn' ? s.replace(/[0-9]/g, (d) => BN[Number(d)]) : s;
};
export const money = (n: number) => `৳${priceNumber(n)}`;
