// apps/tastebud/src/utils/availability.ts
/**
 * Serving / opening hours ("Breakfast Mon–Fri 07:00–11:00").
 * days: 0 = Sunday … 6 = Saturday; end < start runs past midnight.
 * Evaluated in the restaurant's time zone when known (falls back to the device clock).
 */
export type AvailabilityWindow = { days: number[]; start: string; end: string };

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Weekday + minutes-since-midnight of `at` in `tz` (device time when tz is missing/invalid). */
export function wallClock(at: Date, tz?: string | null): { day: number; minutes: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(at);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return { day: WEEKDAY[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
    } catch {
      /* fall through to device time */
    }
  }
  return { day: at.getDay(), minutes: at.getHours() * 60 + at.getMinutes() };
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

/** [1,2,3,4,5] → "Mon–Fri", all days → "", [0,6] → "Sun, Sat" */
export function formatDays(days: number[]): string {
  const d = Array.from(new Set(days)).sort((a, b) => a - b);
  if (d.length === 7) return '';
  const runs: string[] = [];
  for (let i = 0; i < d.length; i++) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    runs.push(j - i >= 2 ? `${DAY[d[i]]}–${DAY[d[j]]}` : d.slice(i, j + 1).map((x) => DAY[x]).join(', '));
    i = j;
  }
  return runs.join(', ');
}

/** "7am–11am" or "Mon–Fri 12pm–3pm · Sat 1pm–4pm" */
export function formatAvailability(windows: AvailabilityWindow[]): string {
  return windows
    .map((w) => [formatDays(w.days), `${formatTime(w.start)}–${formatTime(w.end)}`].filter(Boolean).join(' '))
    .join(' · ');
}

export function isAvailableAt(windows: AvailabilityWindow[] | undefined | null, at: Date, tz?: string | null): boolean {
  if (!windows?.length) return true;
  const { day, minutes: now } = wallClock(at, tz);
  const prev = (day + 6) % 7;
  return windows.some((w) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s < e) return w.days.includes(day) && now >= s && now < e;
    // past midnight: evening part belongs to `day`, early-morning part to the previous day
    return (w.days.includes(day) && now >= s) || (w.days.includes(prev) && now < e);
  });
}

/** Next opening time, e.g. "7am", "tomorrow 7am" or "Mon 7am"; null if never. */
export function nextOpening(
  windows: AvailabilityWindow[] | undefined | null,
  at: Date,
  tz?: string | null
): string | null {
  if (!windows?.length) return null;
  const { day: today, minutes: now } = wallClock(at, tz);
  for (let offset = 0; offset < 8; offset++) {
    const day = (today + offset) % 7;
    const starts = windows
      .filter((w) => w.days.includes(day))
      .map((w) => w.start)
      .filter((s) => offset > 0 || toMin(s) > now)
      .sort((a, b) => toMin(a) - toMin(b));
    if (starts.length) {
      const t = formatTime(starts[0]);
      return offset === 0 ? t : offset === 1 ? `tomorrow ${t}` : `${DAY[day]} ${t}`;
    }
  }
  return null;
}

/**
 * Why an item can't be ordered right now (restaurant closed → section hours →
 * item hours), or null when it can.
 */
export function closedNote(opts: {
  at: Date;
  tz?: string | null;
  openingHours?: AvailabilityWindow[] | null;
  categoryHours?: AvailabilityWindow[] | null;
  itemHours?: AvailabilityWindow[] | null;
  /** Item only sold between these dates (YYYY-MM-DD, inclusive) */
  itemFrom?: string | null;
  itemUntil?: string | null;
}): string | null {
  const { at, tz } = opts;
  if (!isAvailableAt(opts.openingHours, at, tz)) {
    const when = nextOpening(opts.openingHours, at, tz);
    return when ? `Closed · opens ${when}` : 'Closed now';
  }
  if (!isAvailableAt(opts.categoryHours, at, tz)) {
    return `Available ${formatAvailability(opts.categoryHours ?? [])}`;
  }
  if (!isAvailableAt(opts.itemHours, at, tz)) {
    return `Available ${formatAvailability(opts.itemHours ?? [])}`;
  }
  const today = localDate(at, tz);
  if (opts.itemFrom && today < opts.itemFrom) return `Available from ${formatDate(opts.itemFrom)}`;
  if (opts.itemUntil && today > opts.itemUntil) return 'No longer available';
  return null;
}

/** "YYYY-MM-DD" of `at` in the restaurant's time zone (device date if unknown). */
export function localDate(at: Date, tz?: string | null): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** "2026-10-03" → "3 Oct" */
export function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
