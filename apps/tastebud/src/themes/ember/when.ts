// apps/tastebud/src/themes/ember/when.ts
// "When is it back?" in the guest's language: "সন্ধ্যা ৬টা", "কাল সকাল ৮টা", "Fri 7:30 PM". Pure (unit-tested in
// __tests__/emberWhen.test.ts).
import type { nextStart } from '../../utils/availability';

type Next = NonNullable<ReturnType<typeof nextStart>>;

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnDigits = (s: string | number) => String(s).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
const BN_DAY = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The part of the day a Bangla speaker names before the hour. */
function bnDayPart(h: number): string {
  if (h >= 4 && h < 12) return 'সকাল';
  if (h >= 12 && h < 15) return 'দুপুর';
  if (h >= 15 && h < 18) return 'বিকেল';
  if (h >= 18 && h < 20) return 'সন্ধ্যা';
  return 'রাত';
}

export function clockText(start: string, lang: 'bn' | 'en'): string {
  const [h, m] = start.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === 'en') return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  return `${bnDayPart(h)} ${bnDigits(h12)}${m ? `:${bnDigits(String(m).padStart(2, '0'))}` : 'টা'}`;
}

/** "সন্ধ্যা ৬টা" (later today) · "কাল সকাল ৮টা" · "শুক্রবার দুপুর ১২টা" — and the English the same way. */
export function whenText(n: Next, lang: 'bn' | 'en'): string {
  const t = clockText(n.start, lang);
  if (n.offset === 0) return t;
  if (n.offset === 1) return lang === 'en' ? `tomorrow ${t}` : `কাল ${t}`;
  return lang === 'en' ? `${EN_DAY[n.day]} ${t}` : `${BN_DAY[n.day]} ${t}`;
}
