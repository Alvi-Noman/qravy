import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cog6ToothIcon, XMarkIcon } from '@heroicons/react/24/outline';
import HoursEditor, { validateHours, type AvailabilityWindow } from '../Categories/HoursEditor';
import { useServicePeriods, type ServicePeriod } from '../../hooks/useServicePeriods';
import { formatAvailability } from '../../utils/hours';

export type AvailabilityValue = {
  /** Service periods from Settings (Breakfast, Lunch…) */
  servicePeriodIds: string[];
  /** Custom hours for this item/category only */
  availability: AvailabilityWindow[];
  /** Items only: sold between these dates (YYYY-MM-DD, inclusive) */
  availableFrom?: string | null;
  availableUntil?: string | null;
};

type Mode = 'all' | 'periods' | 'custom';

export const SETTINGS_AVAILABILITY_PATH = '/settings/availability';

export function validateAvailability(v: AvailabilityValue): string | null {
  const hours = validateHours(v.availability);
  if (hours) return hours;
  if (v.availableFrom && v.availableUntil && v.availableFrom > v.availableUntil) {
    return 'The end date is before the start date.';
  }
  return null;
}

const modeOf = (v: AvailabilityValue): Mode =>
  v.availability.length ? 'custom' : v.servicePeriodIds.length ? 'periods' : 'all';

const periodTime = (p: ServicePeriod) => formatAvailability([{ days: p.days, start: p.start, end: p.end }]);

const inputCls =
  'rounded-md border border-[#dbdbdb] bg-white px-2.5 py-1.5 text-sm text-[#2e2e30] outline-none focus:border-[#2e2e30]';

/**
 * When can customers order this?
 *   All day · Service periods (shared, from Settings) · Custom hours
 * Items can also be limited to a date range.
 */
export default function AvailabilityEditor({
  value,
  onChange,
  error,
  showDates = false,
  subject = 'item',
}: {
  value: AvailabilityValue;
  onChange: (next: AvailabilityValue) => void;
  error?: string | null;
  showDates?: boolean;
  subject?: 'item' | 'category';
}) {
  const periods = useServicePeriods();
  const [mode, setMode] = useState<Mode>(() => modeOf(value));
  const [showRange, setShowRange] = useState(Boolean(value.availableFrom || value.availableUntil));
  const selected = new Set(value.servicePeriodIds);
  const missing = value.servicePeriodIds.filter((id) => !periods.some((p) => p.id === id));

  const changeMode = (m: Mode) => {
    setMode(m);
    if (m === 'all') onChange({ ...value, servicePeriodIds: [], availability: [] });
    if (m === 'periods') onChange({ ...value, availability: [] });
    if (m === 'custom')
      onChange({
        ...value,
        servicePeriodIds: [],
        availability: value.availability.length
          ? value.availability
          : [{ days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '15:00' }],
      });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label htmlFor="availability-mode" className="text-sm font-medium text-[#2e2e30]">
          Availability
        </label>
        <Link
          to={`${SETTINGS_AVAILABILITY_PATH}#service-periods`}
          className="rounded p-1 text-[#9a9aa0] hover:bg-[#f3f3f3] hover:text-[#2e2e30]"
          title="Manage service periods"
          aria-label="Manage service periods"
        >
          <Cog6ToothIcon className="h-4 w-4" />
        </Link>
      </div>

      <select
        id="availability-mode"
        value={mode}
        onChange={(e) => changeMode(e.target.value as Mode)}
        className={`${inputCls} w-full`}
      >
        <option value="all">All day</option>
        <option value="periods">Service periods</option>
        <option value="custom">Custom hours</option>
      </select>
      {mode === 'all' && (
        <p className="-mt-1 text-xs text-[#9a9aa0]">
          Follows {subject === 'item' ? 'its category and ' : ''}your opening hours.
        </p>
      )}

      {mode === 'periods' && (
        <div>
          {periods.length ? (
            <ul className="divide-y divide-[#f0f0f0] rounded-md border border-[#e5e5e5]">
              {periods.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[#fafafa]">
                    <input
                      type="checkbox"
                      className="accent-[#2e2e30]"
                      checked={selected.has(p.id)}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          servicePeriodIds: e.target.checked
                            ? [...value.servicePeriodIds, p.id]
                            : value.servicePeriodIds.filter((id) => id !== p.id),
                        })
                      }
                    />
                    <span className="flex-1 text-[#2e2e30]">{p.name}</span>
                    <span className="text-xs tabular-nums text-[#9a9aa0]">{periodTime(p)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[#9a9aa0]">
              No service periods yet.{' '}
              <Link to={`${SETTINGS_AVAILABILITY_PATH}#service-periods`} className="underline">
                Add them in Settings
              </Link>
            </p>
          )}
          {missing.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-700">
              {missing.length} selected period{missing.length === 1 ? ' was' : 's were'} deleted in Settings.{' '}
              <button
                type="button"
                className="underline"
                onClick={() =>
                  onChange({ ...value, servicePeriodIds: value.servicePeriodIds.filter((id) => !missing.includes(id)) })
                }
              >
                Remove
              </button>
            </p>
          )}
        </div>
      )}

      {mode === 'custom' && (
        <HoursEditor bare value={value.availability} onChange={(availability) => onChange({ ...value, availability })} />
      )}

      {showDates &&
        (showRange ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#6b6b70]">Dates</span>
            <input
              type="date"
              aria-label="Available from"
              value={value.availableFrom ?? ''}
              onChange={(e) => onChange({ ...value, availableFrom: e.target.value || null })}
              className={inputCls}
            />
            <span className="text-xs text-[#9a9aa0]">–</span>
            <input
              type="date"
              aria-label="Available until"
              value={value.availableUntil ?? ''}
              onChange={(e) => onChange({ ...value, availableUntil: e.target.value || null })}
              className={inputCls}
            />
            <button
              type="button"
              aria-label="Remove date range"
              onClick={() => {
                setShowRange(false);
                onChange({ ...value, availableFrom: null, availableUntil: null });
              }}
              className="rounded p-1 text-[#9a9aa0] hover:text-[#2e2e30]"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowRange(true)}
            className="text-xs text-[#6b6b70] hover:text-[#2e2e30]"
          >
            + Add date range
          </button>
        ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
