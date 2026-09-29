import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { DEFAULT_SERVICE_PERIODS, type ServicePeriod } from '../../hooks/useServicePeriods';
import { toastError, toastSuccess } from '../Toaster';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Row = ServicePeriod & { key: string; isNew?: boolean };
let seq = 0;
const toRows = (list: ServicePeriod[]): Row[] => list.map((p) => ({ ...p, days: [...p.days], key: `r${seq++}` }));

export function validatePeriods(rows: Array<Pick<ServicePeriod, 'name' | 'days' | 'start' | 'end'>>): string | null {
  const names = new Set<string>();
  for (const r of rows) {
    const n = r.name.trim();
    if (!n) return 'Every service period needs a name.';
    if (names.has(n.toLowerCase())) return `"${n}" is used twice.`;
    names.add(n.toLowerCase());
    if (!r.days.length) return `Pick at least one day for "${n}".`;
    if (!r.start || !r.end) return `Set the times for "${n}".`;
    if (r.start === r.end) return `"${n}" starts and ends at the same time.`;
  }
  return null;
}

/**
 * Settings → Hours & availability → Service periods.
 * Items and categories reference these by id, so editing a time here updates
 * every item that uses it. Deleting one makes those items stop using it.
 */
export default function ServicePeriodsCard() {
  const { token } = useAuthContext();
  const { data: tenant } = useTenant();
  const queryClient = useQueryClient();
  const saved = (tenant?.servicePeriods as ServicePeriod[] | undefined) ?? DEFAULT_SERVICE_PERIODS;

  const [rows, setRows] = useState<Row[]>(() => toRows(saved));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(toRows(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  const strip = (r: Row[]) => r.map(({ key: _k, isNew: _n, ...p }) => p);
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(saved);

  const set = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    const err = validatePeriods(rows);
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await updateTenant(
        // new rows get their id from the name on the server; existing ids stay stable
        { servicePeriods: rows.map(({ key: _k, isNew, id, ...p }) => (isNew ? p : { id, ...p })) as any },
        token as string
      );
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Service periods saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save service periods');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="service-periods" className="scroll-mt-20 rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Service periods</div>
      <p className="mt-1 text-[12px] text-slate-500">
        Named times you can pick for items and categories (e.g. put all morning dishes on “Breakfast”). Change a time
        here and every item using it follows. Items can still have their own custom times or dates instead.
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#ececec] p-2">
            <input
              aria-label="Period name"
              value={r.name}
              maxLength={40}
              placeholder="Name (e.g. Brunch)"
              onChange={(e) => set(r.key, { name: e.target.value })}
              className="w-36 rounded-md border border-[#e2e2e2] px-2 py-1.5 text-sm"
            />
            <div className="flex gap-1" role="group" aria-label={`${r.name || 'Period'} days`}>
              {DAYS.map((d, day) => {
                const on = r.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    title={DAY_NAMES[day]}
                    aria-pressed={on}
                    onClick={() =>
                      set(r.key, {
                        days: on ? r.days.filter((x) => x !== day) : [...r.days, day].sort((a, b) => a - b),
                      })
                    }
                    className={`h-7 w-7 rounded-full text-xs font-medium ${
                      on ? 'bg-slate-900 text-white' : 'border border-[#dbdbdb] text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <input
              type="time"
              aria-label={`${r.name} start`}
              value={r.start}
              onChange={(e) => set(r.key, { start: e.target.value })}
              className="rounded-md border border-[#e2e2e2] px-2 py-1 text-sm"
            />
            <span className="text-sm text-slate-500">to</span>
            <input
              type="time"
              aria-label={`${r.name} end`}
              value={r.end}
              onChange={(e) => set(r.key, { end: e.target.value })}
              className="rounded-md border border-[#e2e2e2] px-2 py-1 text-sm"
            />
            <button
              type="button"
              aria-label={`Delete ${r.name || 'period'}`}
              title="Items using this period will stop using it"
              onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
              className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No service periods. Add one, or restore the defaults.</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {rows.length < 12 && (
          <button
            type="button"
            onClick={() =>
              setRows((cur) => [
                ...cur,
                { key: `r${seq++}`, id: '', name: '', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '15:00', isNew: true },
              ])
            }
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <PlusIcon className="h-4 w-4" /> Add period
          </button>
        )}
        <button
          type="button"
          onClick={() => setRows(toRows(DEFAULT_SERVICE_PERIODS))}
          className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          Restore defaults
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save service periods'}
        </button>
      </div>
    </section>
  );
}
