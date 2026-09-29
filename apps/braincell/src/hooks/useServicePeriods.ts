import { useTenant } from './useTenant';

export type ServicePeriod = { id: string; name: string; days: number[]; start: string; end: string };

const ALL = [0, 1, 2, 3, 4, 5, 6];

/** Mirrors the server defaults (shown until the owner edits them). */
export const DEFAULT_SERVICE_PERIODS: ServicePeriod[] = [
  { id: 'breakfast', name: 'Breakfast', days: ALL, start: '07:00', end: '11:00' },
  { id: 'lunch', name: 'Lunch', days: ALL, start: '12:00', end: '15:00' },
  { id: 'afternoon', name: 'Afternoon', days: ALL, start: '15:00', end: '18:00' },
  { id: 'dinner', name: 'Dinner', days: ALL, start: '18:00', end: '23:00' },
  { id: 'late-night', name: 'Late night', days: ALL, start: '22:00', end: '02:00' },
];

/** The restaurant's service periods (Settings → Hours & availability). */
export function useServicePeriods(): ServicePeriod[] {
  const { data: tenant } = useTenant();
  return (tenant?.servicePeriods as ServicePeriod[] | undefined) ?? DEFAULT_SERVICE_PERIODS;
}
