import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Serving hours for a category ("Breakfast 07:00–11:00, Mon–Fri").
 * Empty list = always available. days: 0 = Sunday … 6 = Saturday.
 */
export type AvailabilityWindow = { days: number[]; start: string; end: string };

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function validateHours(windows: AvailabilityWindow[]): string | null {
  for (const w of windows) {
    if (!w.days.length) return 'Pick at least one day for each time slot.';
    if (!/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end)) return 'Enter a start and end time.';
    if (w.start === w.end) return 'Start and end time must be different.';
  }
  return null;
}

export default function HoursEditor({
  value,
  onChange,
  error,
  label = 'Only available at certain times',
  help = 'e.g. Breakfast 7–11am or Happy hour. Outside these hours customers see the items but can’t order them.',
  defaultWindow = { days: [...ALL_DAYS], start: '07:00', end: '11:00' },
  bare = false,
}: {
  value: AvailabilityWindow[];
  onChange: (next: AvailabilityWindow[]) => void;
  error?: string | null;
  label?: string;
  help?: string;
  /** First time slot added when the checkbox is ticked */
  defaultWindow?: AvailabilityWindow;
  /** Just the time-slot rows (no checkbox/label/help) — the parent decides when hours apply */
  bare?: boolean;
}) {
  const limited = bare || value.length > 0;
  const set = (i: number, patch: Partial<AvailabilityWindow>) =>
    onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <div className="space-y-2">
      {!bare && (
        <>
          <label className="inline-flex items-center gap-2 text-sm text-[#2e2e30]">
            <input
              type="checkbox"
              checked={limited}
              onChange={(e) =>
                onChange(e.target.checked ? [{ ...defaultWindow, days: [...defaultWindow.days] }] : [])
              }
            />
            {label}
          </label>
          <p className="text-xs text-[#6b6b70]">{help}</p>
        </>
      )}


      {limited && (
        <div className="space-y-2">
          {value.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-[#e5e5e5] p-2">
              <div className="flex gap-1" role="group" aria-label="Days">
                {DAYS.map((d, day) => {
                  const on = w.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      title={DAY_NAMES[day]}
                      aria-pressed={on}
                      onClick={() =>
                        set(i, {
                          days: on ? w.days.filter((x) => x !== day) : [...w.days, day].sort((a, b) => a - b),
                        })
                      }
                      className={`h-7 w-7 rounded-full text-xs font-medium ${
                        on ? 'bg-[#2e2e30] text-white' : 'border border-[#dbdbdb] text-[#6b6b70] hover:bg-[#f6f6f6]'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <input
                type="time"
                aria-label="Start time"
                value={w.start}
                onChange={(e) => set(i, { start: e.target.value })}
                className="rounded-md border border-[#dbdbdb] px-2 py-1 text-sm"
              />
              <span className="text-sm text-[#6b6b70]">to</span>
              <input
                type="time"
                aria-label="End time"
                value={w.end}
                onChange={(e) => set(i, { end: e.target.value })}
                className="rounded-md border border-[#dbdbdb] px-2 py-1 text-sm"
              />
              <button
                type="button"
                aria-label="Remove time slot"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="ml-auto rounded p-1 text-[#9a9aa0] hover:text-red-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...value, { days: [...ALL_DAYS], start: '12:00', end: '15:00' }])}
            className="inline-flex items-center gap-1 text-sm text-[#6b6b70] hover:text-[#2e2e30]"
          >
            <PlusIcon className="h-4 w-4" /> Add time slot
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
