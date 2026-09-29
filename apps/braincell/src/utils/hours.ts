/** Serving-hours helpers shared by the admin UI. days: 0 = Sunday … 6 = Saturday. */
export type AvailabilityWindow = { days: number[]; start: string; end: string };

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

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
export function formatAvailability(windows: AvailabilityWindow[] | undefined | null): string {
  return (windows ?? [])
    .map((w) => [formatDays(w.days), `${formatTime(w.start)}–${formatTime(w.end)}`].filter(Boolean).join(' '))
    .join(' · ');
}

