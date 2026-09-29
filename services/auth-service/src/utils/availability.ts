/**
 * Time-based availability: restaurant opening hours, category/item serving hours,
 * "sold out until tomorrow" resets. All times are wall-clock times in the
 * restaurant's IANA time zone (e.g. "Asia/Dhaka").
 *
 * Window: days 0 = Sunday … 6 = Saturday; "HH:mm"; end < start runs past midnight.
 */
export type AvailabilityWindow = { days: number[]; start: string; end: string };

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';
export const DEFAULT_RESET_TIME = '05:00';
const MAX_WINDOWS = 7;

/** "7:00", "07:00", "7" → "07:00"; invalid → null */
export function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return `${String(h === 24 ? 0 : h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Cleans untrusted windows; drops invalid ones. Empty result = always available. */
export function normalizeAvailability(list: unknown): AvailabilityWindow[] {
  const out: AvailabilityWindow[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const w = raw as Record<string, unknown>;
    const start = normalizeTime(w?.start);
    const end = normalizeTime(w?.end);
    if (!start || !end || start === end) continue;
    const days = Array.from(
      new Set(
        (Array.isArray(w.days) ? w.days : ALL_DAYS)
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      )
    ).sort((a, b) => a - b);
    if (!days.length) continue;
    const key = `${days.join(',')}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ days, start, end });
    if (out.length >= MAX_WINDOWS) break;
  }
  return out;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `at` in `tz`. */
export function zonedParts(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when `at` falls inside any window (empty/undefined = always). */
export function isWithinWindows(windows: AvailabilityWindow[] | undefined | null, tz: string, at: Date): boolean {
  if (!windows?.length) return true;
  const { weekday: day, minutes: now } = zonedParts(at, tz);
  const prev = (day + 6) % 7;
  return windows.some((w) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s < e) return w.days.includes(day) && now >= s && now < e;
    // past midnight: evening part belongs to `day`, early-morning part to the previous day
    return (w.days.includes(day) && now >= s) || (w.days.includes(prev) && now < e);
  });
}

/** Offset of `tz` from UTC at instant `at`, in minutes (Dhaka → +360). */
function tzOffsetMinutes(tz: string, at: Date): number {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * Next time the wall clock in `tz` shows `hhmm`, strictly after `from`
 * (e.g. the 05:00 daily reset for "sold out until tomorrow").
 */
export function nextWallClockTime(hhmm: string, tz: string, from: Date): Date {
  const target = toMin(normalizeTime(hhmm) ?? DEFAULT_RESET_TIME);
  const p = zonedParts(from, tz);
  for (let addDays = 0; addDays < 3; addDays++) {
    // Candidate as if the zone were UTC, then shift by the zone offset
    const naive = Date.UTC(p.year, p.month - 1, p.day + addDays, Math.floor(target / 60), target % 60);
    // Offset can differ at the target instant (DST switch) — refine once.
    const guess = naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000;
    const candidate = new Date(naive - tzOffsetMinutes(tz, new Date(guess)) * 60_000);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return new Date(from.getTime() + 24 * 3600_000);
}

/**
 * Whether something can be ordered right now: the restaurant (or branch) is
 * open, its category is being served and the item's own hours allow it.
 * Returns a short customer-facing reason when not.
 */
export function orderableNow(opts: {
  tz: string;
  at: Date;
  openingHours?: AvailabilityWindow[] | null;
  categoryHours?: AvailabilityWindow[] | null;
  itemHours?: AvailabilityWindow[] | null;
  /** Item only sold between these dates (inclusive, restaurant time zone) */
  itemFrom?: string | null;
  itemUntil?: string | null;
  categoryName?: string;
}): { ok: true } | { ok: false; reason: 'closed' | 'category' | 'item' | 'dates'; message: string } {
  const { tz, at } = opts;
  if (!isWithinWindows(opts.openingHours, tz, at)) {
    return { ok: false, reason: 'closed', message: 'The restaurant is closed right now.' };
  }
  if (!isWithinWindows(opts.categoryHours, tz, at)) {
    return {
      ok: false,
      reason: 'category',
      message: `${opts.categoryName ? `${opts.categoryName} is` : 'This section is'} not being served right now.`,
    };
  }
  if (!isWithinWindows(opts.itemHours, tz, at)) {
    return { ok: false, reason: 'item', message: 'This item is not available right now.' };
  }
  if (!isWithinDates(opts.itemFrom, opts.itemUntil, tz, at)) {
    return { ok: false, reason: 'dates', message: 'This item is not available on this date.' };
  }
  return { ok: true };
}

/* ------------------------------ Service periods ------------------------------ */

/**
 * Named, restaurant-wide time slots (Breakfast, Lunch…) that items and
 * categories reference by id — change Breakfast once, every breakfast item follows.
 */
export type ServicePeriod = { id: string; name: string; days: number[]; start: string; end: string };

export const DEFAULT_SERVICE_PERIODS: ServicePeriod[] = [
  { id: 'breakfast', name: 'Breakfast', days: ALL_DAYS, start: '07:00', end: '11:00' },
  { id: 'lunch', name: 'Lunch', days: ALL_DAYS, start: '12:00', end: '15:00' },
  { id: 'afternoon', name: 'Afternoon', days: ALL_DAYS, start: '15:00', end: '18:00' },
  { id: 'dinner', name: 'Dinner', days: ALL_DAYS, start: '18:00', end: '23:00' },
  { id: 'late-night', name: 'Late night', days: ALL_DAYS, start: '22:00', end: '02:00' },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** Cleans untrusted periods: valid times, unique ids (kept stable), max 12. */
export function normalizeServicePeriods(list: unknown): ServicePeriod[] {
  const out: ServicePeriod[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const p = raw as Record<string, unknown>;
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : '';
    const [w] = normalizeAvailability([p]);
    if (!name || !w) continue;
    let id = typeof p.id === 'string' && p.id.trim() ? slug(p.id) : slug(name);
    if (!id) id = `period-${out.length + 1}`;
    let unique = id;
    for (let n = 2; ids.has(unique); n++) unique = `${id}-${n}`;
    ids.add(unique);
    out.push({ id: unique, name, ...w });
    if (out.length >= 12) break;
  }
  return out;
}

/** The restaurant's periods (defaults until the owner edits them). */
export function tenantServicePeriods(tenant: { servicePeriods?: ServicePeriod[] } | null | undefined): ServicePeriod[] {
  return Array.isArray(tenant?.servicePeriods) ? tenant!.servicePeriods : DEFAULT_SERVICE_PERIODS;
}

/**
 * Effective hours = the referenced service periods + custom windows.
 * Unknown/deleted period ids are ignored. Empty result = always.
 */
export function resolveWindows(
  periodIds: string[] | undefined | null,
  custom: AvailabilityWindow[] | undefined | null,
  periods: ServicePeriod[]
): AvailabilityWindow[] {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const fromPeriods = (periodIds ?? [])
    .map((id) => byId.get(id))
    .filter((p): p is ServicePeriod => !!p)
    .map(({ days, start, end }) => ({ days, start, end }));
  return [...fromPeriods, ...(custom ?? [])];
}

/* -------------------------------- Date ranges -------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Today's date ("YYYY-MM-DD") in the restaurant's time zone. */
export function zonedDate(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Inclusive date range check in the restaurant's time zone; open ends allowed. */
export function isWithinDates(from: string | null | undefined, until: string | null | undefined, tz: string, at: Date) {
  const today = zonedDate(at, tz);
  if (from && today < from) return false;
  if (until && today > until) return false;
  return true;
}
