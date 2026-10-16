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
/** One of the restaurant's open branches: its link is "<restaurant>/<slug>", its tables are its own. */
export type StoreBranch = { slug: string; name: string; address: string; tables: string[] };

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
  branches: StoreBranch[];
  /** the branch the main link orders from (the owner's choice); null → the guest picks */
  mainBranch: string | null;
  /** the restaurant's name and address (Settings) */
  restaurant: { name: string; address: string };
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
  const branches = Array.isArray((data as any)?.branches) ? ((data as any).branches as StoreBranch[]) : [];
  const mainBranch = typeof (data as any)?.mainBranch === 'string' ? ((data as any).mainBranch as string) : null;
  const restaurant = { name: String((data as any)?.name ?? ''), address: String((data as any)?.address ?? '') };
  return { dineIn: ch?.dineIn !== false, online: ch?.online !== false, loaded: isFetched, tables, branches, mainBranch, restaurant };
}

/** Where a pickup order is collected: its branch (or the only branch) with its address, else the restaurant itself. */
export function usePickupPlace(sub?: string | null, slug?: string | null): { name: string; address: string } {
  const { branches, restaurant } = useStoreChannels(sub);
  const b = (slug ? branches.find((x) => x.slug === slug) : null) ?? (branches.length === 1 ? branches[0] : null);
  return { name: restaurant.name || b?.name || '', address: b?.address || restaurant.address || '' };
}

/** The guest's branch (name, address) at a restaurant with two or more — shown at checkout and on the order page
 *  ("Pickup at Gulshan 2 (Main), Road 11"). Null for a restaurant with one branch or none. */
export function useStoreBranch(sub?: string | null, slug?: string | null): StoreBranch | null {
  const { branches } = useStoreChannels(sub);
  if (!slug || branches.length < 2) return null;
  return branches.find((b) => b.slug === slug) ?? null;
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

/** Delivery or pickup (online orders) — delivery unless the guest chose pickup here before; remembered per restaurant
 *  and kept in sync across the page. */
export function useFulfillment(sub?: string | null): [Fulfillment, (f: Fulfillment) => void] {
  const load = useCallback((): Fulfillment => {
    try {
      return localStorage.getItem(fulfillmentKey(sub)) === 'pickup' ? 'pickup' : 'delivery';
    } catch {
      return 'delivery';
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

/** Delivery or pickup as the toggle shows it right now (the waiter is told with every utterance). */
export function fulfillmentNow(sub?: string | null): Fulfillment {
  try {
    return localStorage.getItem(fulfillmentKey(sub)) === 'pickup' ? 'pickup' : 'delivery';
  } catch {
    return 'delivery';
  }
}

/** Every contact field still empty on this device right now — the waiter is told, so it only ever asks for those (a
 *  returning guest's name / phone / address is never asked again). The address is listed whatever the toggle says:
 *  the waiter counts it only for delivery (so "pickup" by voice knows there's nothing left to ask). */
export function contactMissingNow(sub?: string | null): (keyof GuestContact)[] {
  const c = read(contactKey(sub), EMPTY_CONTACT);
  const out: (keyof GuestContact)[] = [];
  if (!c.name.trim()) out.push('name');
  if (c.phone.replace(/\D/g, '').length < 6) out.push('phone');
  if (!c.address.trim()) out.push('address');
  return out;
}

/* ------------------------------------------------------------------ the kitchen note */

// "Note for the kitchen" for the order being put together — one per restaurant, the same in the tray, on the
// checkout page and for the voice waiter (it goes with an order the guest confirms by voice too); kept for the tab's
// life (moving between pages keeps it) and cleared once the order is placed (it never rides along on the next one)
const noteKey = (sub?: string | null) => `qravy:order-note:${sub || ''}`;
const NOTE_EVENT = 'qravy:order-note';
const memoryNotes: Record<string, string> = {};

export function readOrderNote(sub?: string | null): string {
  try {
    return sessionStorage.getItem(noteKey(sub)) ?? memoryNotes[noteKey(sub)] ?? '';
  } catch {
    return memoryNotes[noteKey(sub)] ?? '';
  }
}

export function setOrderNote(sub: string | null | undefined, note: string): void {
  const k = noteKey(sub);
  memoryNotes[k] = note;
  try {
    if (note) sessionStorage.setItem(k, note);
    else sessionStorage.removeItem(k);
  } catch {
    /* storage blocked — the memory copy does */
  }
  try {
    window.dispatchEvent(new CustomEvent(NOTE_EVENT, { detail: k }));
  } catch {
    /* no window */
  }
}

/** The order was placed: its note is done. */
export const clearOrderNote = (sub?: string | null) => setOrderNote(sub, '');

export function useOrderNote(sub?: string | null): [string, (note: string) => void] {
  const [note, setNote] = useState(() => readOrderNote(sub));
  useEffect(() => {
    setNote(readOrderNote(sub));
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === noteKey(sub)) setNote(readOrderNote(sub));
    };
    window.addEventListener(NOTE_EVENT, on);
    return () => window.removeEventListener(NOTE_EVENT, on);
  }, [sub]);
  const update = useCallback((v: string) => setOrderNote(sub, v), [sub]);
  return [note, update];
}
