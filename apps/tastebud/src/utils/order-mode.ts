// apps/tastebud/src/utils/order-mode.ts
// How this guest is ordering:
//   dine-in → they have a table (from the table QR, ?table=12) or opened the dine-in menu; checkout asks for the table
//   online  → everyone else, when the restaurant sells online; they choose pickup or delivery and give contact details
// Pickup/delivery and the contact details are remembered per restaurant, like a normal shop checkout.
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTenant, type Channel } from '../api/storefront';
import { getTable } from './table';

export type Fulfillment = 'pickup' | 'delivery';
export type GuestContact = { name: string; phone: string; address: string };

const EMPTY_CONTACT: GuestContact = { name: '', phone: '', address: '' };
const fulfillmentKey = (sub?: string | null) => `qravy:fulfillment:${sub || 'anon'}`;
const contactKey = (sub?: string | null) => `qravy:contact:${sub || 'anon'}`;
const FULFILLMENT_EVENT = 'qravy:fulfillment';
const TABLE_EVENT = 'qravy:table';

/** Which ways the restaurant takes orders (missing info = both on). Shares the DigitalMenu tenant cache. */
export function useStoreChannels(sub?: string | null): { dineIn: boolean; online: boolean; loaded: boolean } {
  const { data, isFetched } = useQuery({
    queryKey: ['tenantInfo', sub],
    enabled: Boolean(sub),
    queryFn: async () => {
      const storeTenant = (typeof window !== 'undefined' ? (window as any).__STORE__?.tenant : undefined) ?? null;
      if (storeTenant) return storeTenant;
      return sub ? await getTenant(sub) : null;
    },
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const ch = (data as any)?.channels;
  return { dineIn: ch?.dineIn !== false, online: ch?.online !== false, loaded: isFetched };
}

/** Pure rule, shared with tests: a table means dine-in; otherwise online if the restaurant sells online. */
export function resolveChannel(opts: {
  table: string | null;
  hint?: Channel | null;
  dineIn: boolean;
  online: boolean;
}): Channel {
  if (!opts.online) return 'dine-in';
  if (!opts.dineIn) return 'online';
  if (opts.table) return 'dine-in';
  return opts.hint === 'dine-in' ? 'dine-in' : 'online';
}

/** The guest's channel. `hint` = what the page/host says (e.g. the /menu/dine-in path, __STORE__.channel). */
export function useOrderChannel(sub?: string | null, hint?: Channel | null): Channel {
  const { dineIn, online } = useStoreChannels(sub);
  const [table, setTable] = useState<string | null>(() => getTable(sub));
  useEffect(() => {
    setTable(getTable(sub));
    const onChange = () => setTable(getTable(sub));
    window.addEventListener(TABLE_EVENT, onChange);
    return () => window.removeEventListener(TABLE_EVENT, onChange);
  }, [sub]);
  const storeHint = typeof window !== 'undefined' ? ((window as any).__STORE__?.channel as Channel | undefined) : undefined;
  return resolveChannel({ table, hint: hint ?? storeHint ?? null, dineIn, online });
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** Pickup or delivery (online orders), remembered per restaurant and kept in sync across the page. */
export function useFulfillment(sub?: string | null): [Fulfillment, (f: Fulfillment) => void] {
  const load = useCallback((): Fulfillment => {
    try {
      return localStorage.getItem(fulfillmentKey(sub)) === 'delivery' ? 'delivery' : 'pickup';
    } catch {
      return 'pickup';
    }
  }, [sub]);
  const [value, setValue] = useState<Fulfillment>(load);

  useEffect(() => {
    setValue(load());
    const onChange = () => setValue(load());
    window.addEventListener(FULFILLMENT_EVENT, onChange);
    return () => window.removeEventListener(FULFILLMENT_EVENT, onChange);
  }, [load]);

  const update = useCallback(
    (f: Fulfillment) => {
      try {
        localStorage.setItem(fulfillmentKey(sub), f);
      } catch {
        /* storage blocked */
      }
      setValue(f);
      window.dispatchEvent(new CustomEvent(FULFILLMENT_EVENT));
    },
    [sub],
  );
  return [value, update];
}

/** Name / phone / address, remembered on this device for next time. */
export function useGuestContact(sub?: string | null): [GuestContact, (patch: Partial<GuestContact>) => void] {
  const [contact, setContact] = useState<GuestContact>(() => read(contactKey(sub), EMPTY_CONTACT));
  useEffect(() => setContact(read(contactKey(sub), EMPTY_CONTACT)), [sub]);
  const update = useCallback(
    (patch: Partial<GuestContact>) => {
      setContact((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(contactKey(sub), JSON.stringify(next));
        } catch {
          /* storage blocked */
        }
        return next;
      });
    },
    [sub],
  );
  return [contact, update];
}

/** First missing field for an online order, or null when it's complete. */
export function missingContactField(f: Fulfillment, c: GuestContact): keyof GuestContact | null {
  if (!c.name.trim()) return 'name';
  if (c.phone.replace(/\D/g, '').length < 6) return 'phone';
  if (f === 'delivery' && !c.address.trim()) return 'address';
  return null;
}
