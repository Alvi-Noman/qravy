// services/auth-service/src/utils/period.ts
// Date ranges as a restaurant means them — "Today" is since midnight in ITS timezone (Asia/Dhaka), not the last 24
// hours — and the period just before it, for "compared with yesterday / the previous 7 days".
export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export type Period = {
  key: RangeKey;
  from: Date;
  /** exclusive */
  to: Date;
  /** "hour" for a single day, else "day" */
  bucket: 'hour' | 'day';
  /** the same length just before it */
  prevFrom: Date;
  prevTo: Date;
  /** the window includes this moment (live numbers make sense) */
  includesNow: boolean;
  /** local calendar dates, inclusive: "2026-10-14" */
  fromDate: string;
  toDate: string;
};

type Ymd = { y: number; m: number; d: number };

function partsIn(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)])
  ) as Record<string, number>;
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** How far the timezone is ahead of UTC at that moment (ms). */
function offsetMs(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Local midnight of a calendar date, as a real instant. */
export function startOfDay(ymd: Ymd, tz: string): Date {
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // a DST change on that day
  return new Date(t);
}

const addDays = (ymd: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
export const ymdOf = (at: Date, tz: string): Ymd => {
  const p = partsIn(at, tz);
  return { y: p.y, m: p.m, d: p.d };
};
export const ymdStr = (x: Ymd) => `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
const parseYmd = (s: unknown): Ymd | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const x = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return ymdStr(addDays(x, 0)) === m[0] ? x : null; // a real date ("2026-02-30" isn't)
};
const daysBetween = (a: Ymd, b: Ymd) => Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400_000);

/** The local hour (0–23) and calendar date of an instant — for bucketing charts in the restaurant's own time. */
export function localHourAndDate(at: Date, tz: string): { hour: number; date: string } {
  const p = partsIn(at, tz);
  return { hour: p.h, date: ymdStr({ y: p.y, m: p.m, d: p.d }) };
}

/** "today" | "yesterday" | "7d" | "30d" | "month" | custom from..to ("2026-10-01".."2026-10-14", inclusive, ≤ 1 year). */
export function periodOf(range: unknown, fromRaw: unknown, toRaw: unknown, tz: string, now = new Date()): Period {
  const today = ymdOf(now, tz);
  let key: RangeKey = (['today', 'yesterday', '7d', '30d', 'month', 'custom'] as const).includes(range as RangeKey)
    ? (range as RangeKey)
    : 'today';
  let first: Ymd = today;
  let last: Ymd = today;
  if (key === 'yesterday') first = last = addDays(today, -1);
  else if (key === '7d') first = addDays(today, -6);
  else if (key === '30d') first = addDays(today, -29);
  else if (key === 'month') first = { ...today, d: 1 };
  else if (key === 'custom') {
    const a = parseYmd(fromRaw);
    const b = parseYmd(toRaw) ?? a;
    if (!a || !b) key = 'today';
    else {
      [first, last] = daysBetween(a, b) >= 0 ? [a, b] : [b, a];
      if (daysBetween(first, last) > 365) first = addDays(last, -365);
      if (daysBetween(last, today) < 0) last = today; // nothing has happened in the future yet
      if (daysBetween(first, last) < 0) first = last;
    }
  }
  const from = startOfDay(first, tz);
  const to = startOfDay(addDays(last, 1), tz);
  const len = to.getTime() - from.getTime();
  return {
    key,
    from,
    to,
    bucket: daysBetween(first, last) === 0 ? 'hour' : 'day',
    prevFrom: new Date(from.getTime() - len),
    prevTo: from,
    includesNow: now >= from && now < to,
    fromDate: ymdStr(first),
    toDate: ymdStr(last),
  };
}

/** The calendar dates a day-bucketed chart has, in order. */
export function datesOf(p: { fromDate: string; toDate: string }): string[] {
  const a = parseYmd(p.fromDate)!;
  const n = daysBetween(a, parseYmd(p.toDate)!);
  return Array.from({ length: n + 1 }, (_, i) => ymdStr(addDays(a, i)));
}
