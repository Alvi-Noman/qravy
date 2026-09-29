import { useTenant } from './useTenant';

export type KitchenSettings = { defaultPrepMinutes: number; parallelOrders: number };

/** Mirrors the server defaults (services/orders/waitTime.ts). */
export const DEFAULT_KITCHEN: KitchenSettings = { defaultPrepMinutes: 15, parallelOrders: 3 };

/** Wait-time settings (Settings → Hours & availability → Kitchen). */
export function useKitchenSettings(): KitchenSettings {
  const { data: tenant } = useTenant();
  return { ...DEFAULT_KITCHEN, ...((tenant as { kitchen?: Partial<KitchenSettings> } | undefined)?.kitchen ?? {}) };
}

/** "" → no time of its own; otherwise whole minutes 1–240. */
export function parsePrepMinutes(s: string | undefined | null): number | null | 'invalid' {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 240) return 'invalid';
  return n;
}
