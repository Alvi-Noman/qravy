/**
 * Settings → Hours & availability — every time-based rule in one place:
 *   - time zone (all hours use it)
 *   - opening hours (+ per-branch overrides)
 *   - service periods (Breakfast, Lunch…) that items/categories pick from
 *   - daily reset time for "Sold out today"
 *   - kitchen: default prep time + orders cooked at once (wait-time estimates)
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { fetchLocations, updateLocationHours, type Location } from '../../api/locations';
import HoursEditor, { validateHours, type AvailabilityWindow } from '../../components/Categories/HoursEditor';
import { toastError, toastSuccess } from '../../components/Toaster';
import ServicePeriodsCard from '../../components/availability/ServicePeriodsCard';
import KitchenCard from '../../components/availability/KitchenCard';

const COMMON_ZONES = [
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

const OPEN_DEFAULT: AvailabilityWindow = { days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '23:00' };

function allTimeZones(): string[] {
  try {
    const list = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
    if (list?.length) return Array.from(new Set([...COMMON_ZONES, ...list]));
  } catch {}
  return COMMON_ZONES;
}

function nowIn(tz: string): string {
  try {
    return new Date().toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'short' });
  } catch {
    return '';
  }
}

function BranchHours({ location }: { location: Location }) {
  const queryClient = useQueryClient();
  const [own, setOwn] = useState<boolean>(Array.isArray(location.openingHours));
  const [hours, setHours] = useState<AvailabilityWindow[]>(location.openingHours ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saved = Array.isArray(location.openingHours) ? location.openingHours : null;
  const next = own ? hours : null;
  const dirty = JSON.stringify(saved) !== JSON.stringify(next);

  const save = async () => {
    const err = own ? validateHours(hours) : null;
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await updateLocationHours(location.id, next);
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      toastSuccess(`Hours saved for ${location.name}`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save branch hours');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#ececec] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-900">{location.name}</div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!own}
            onChange={(e) => {
              setOwn(!e.target.checked);
              if (!e.target.checked && !hours.length) setHours([{ ...OPEN_DEFAULT, days: [...OPEN_DEFAULT.days] }]);
            }}
          />
          Same as restaurant
        </label>
      </div>
      {own && (
        <div className="mt-3">
          <HoursEditor
            value={hours}
            onChange={(v) => {
              setHours(v);
              if (error) setError(validateHours(v));
            }}
            error={error}
            label="Open only at certain times"
            help="Leave unticked if this branch is open 24/7."
            defaultWindow={OPEN_DEFAULT}
          />
        </div>
      )}
      {dirty && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save branch hours'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsHoursAvailability(): JSX.Element {
  const { token } = useAuthContext();
  const { data: tenant } = useTenant();
  const queryClient = useQueryClient();
  const zones = useMemo(allTimeZones, []);

  const [timezone, setTimezone] = useState('Asia/Dhaka');
  const [hours, setHours] = useState<AvailabilityWindow[]>([]);
  const [resetTime, setResetTime] = useState('05:00');
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Deep links from the gear icons: /settings/availability#service-periods
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!tenant) return;
    setTimezone(tenant.timezone || 'Asia/Dhaka');
    setHours(tenant.openingHours ?? []);
    setResetTime(tenant.dailyResetTime || '05:00');
  }, [tenant]);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', 'opening-hours'],
    queryFn: fetchLocations,
    enabled: !!token,
  });

  const dirty =
    !!tenant &&
    (timezone !== (tenant.timezone || 'Asia/Dhaka') ||
      resetTime !== (tenant.dailyResetTime || '05:00') ||
      JSON.stringify(hours) !== JSON.stringify(tenant.openingHours ?? []));

  const save = async () => {
    const err = validateHours(hours);
    setHoursError(err);
    if (err) return;
    setSaving(true);
    try {
      await updateTenant({ timezone, openingHours: hours, dailyResetTime: resetTime }, token as string);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Opening hours saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save opening hours');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-[16px] font-semibold text-slate-900">Hours & availability</h2>
        <p className="text-[12px] text-slate-500">
          When you’re open, when each part of the menu is served, and when sold-out items come back.
        </p>
      </div>

      <div id="opening-hours" className="scroll-mt-20 rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Opening hours</div>
        <p className="mt-1 text-[12px] text-slate-500">
          When you’re closed, customers can still browse your menu but can’t order. Category and item serving hours
          (e.g. Breakfast 7–11am) work on top of these.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700" htmlFor="tz">
              Time zone
            </label>
            <select
              id="tz"
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-slate-500">Now there: {nowIn(timezone)}</span>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700" htmlFor="reset">
              “Sold out today” comes back at
            </label>
            <input
              id="reset"
              type="time"
              value={resetTime}
              onChange={(e) => setResetTime(e.target.value)}
              className="w-40 rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
            />
            <span className="text-[12px] text-slate-500">
              Items marked “Sold out today” switch back on automatically at this time.
            </span>
          </div>
        </div>

        <div className="mt-5">
          <HoursEditor
            value={hours}
            onChange={(v) => {
              setHours(v);
              if (hoursError) setHoursError(validateHours(v));
            }}
            error={hoursError}
            label="Open only at certain times"
            help="Leave unticked if you take orders around the clock."
            defaultWindow={OPEN_DEFAULT}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <ServicePeriodsCard />

      <KitchenCard />

      {locations.length > 0 && (
        <div id="branch-hours" className="scroll-mt-20 rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
          <div className="text-[14px] font-semibold text-slate-900">Branch hours</div>
          <p className="mt-1 text-[12px] text-slate-500">
            Branches follow the restaurant’s hours unless you give them their own. To give one branch different
            serving hours for a category (e.g. breakfast until noon), switch to that branch and edit the category.
          </p>
          <div className="mt-3 grid gap-3">
            {locations.map((l) => (
              <BranchHours key={`${l.id}:${JSON.stringify(l.openingHours ?? null)}`} location={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
