// apps/tastebud/src/utils/order-mode.ts
// How this guest is ordering — the link decides:
//   dine-in → "/t/<sub>/dine-in?table=12" (the table's QR code) and every page under it; the order goes to that table
//   online  → "/t/<sub>" and every page under it; they choose pickup or delivery and give name / phone / address
// Pickup/delivery and the contact details are remembered per restaurant, like a normal shop checkout.
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTenant, type Channel } from '../api/storefront';
import { isDineInPath } from './table';

export type Fulfillment = 'pickup' | 'delivery';
export type GuestContact = { name: string; phone: string; address: string };

const EMPTY_CONTACT: GuestContact = { name: '', phone: '', address: '' };
const fulfillmentKey = (sub?: string | null) => `qravy:fulfillment:${sub || 'anon'}`;
const contactKey = (sub?: string | null) => `qravy:contact:${sub || 'anon'}`;
const FULFILLMENT_EVENT = 'qravy:fulfillment';

/** Which ways the restaurant takes orders (missing info = both on). Shares the DigitalMenu tenant cache. */
export function useStoreChannels(sub?: string | null): {
  dineIn: boolean;
  online: boolean;
  loaded: boolean;
  tables: string[];
} {
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
  const tables = Array.isArray((data as any)?.tables) ? ((data as any).tables as string[]) : [];
  return { dineIn: ch?.dineIn !== false, online: ch?.online !== false, loaded: isFetched, tables };
}

/** Pure rule: the dine-in side of the site ("…/dine-in…") is dine-in, everything else is the online shop — unless
 *  the restaurant only does one of the two (KeepTableInUrl moves the guest to that side). */
export function resolveChannel(opts: { dineInPath: boolean; dineIn: boolean; online: boolean }): Channel {
  if (!opts.online) return 'dine-in';
  if (!opts.dineIn) return 'online';
  return opts.dineInPath ? 'dine-in' : 'online';
}

/** The guest's channel, from the page's link. */
export function useOrderChannel(sub?: string | null): Channel {
  const { dineIn, online } = useStoreChannels(sub);
  const { pathname } = useLocation();
  return resolveChannel({ dineInPath: isDineInPath(pathname), dineIn, online });
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
