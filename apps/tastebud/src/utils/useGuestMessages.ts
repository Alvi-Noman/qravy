// apps/tastebud/src/utils/useGuestMessages.ts — the restaurant's own guest messages (and the names their placeholders use),
// from the tenant info every storefront page shares. The text logic itself is in ./guestMessages (no app imports, testable).
import { useQuery } from '@tanstack/react-query';
import { getTenant } from '../api/storefront';
import type { GuestMessages } from './guestMessages';


/** The same tenant info every storefront page uses (one request, shared). */
export function useGuestMessages(sub?: string | null): { messages: GuestMessages | null; restaurant: string | null; waiter: string } {
  const { data } = useQuery({
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
  const t = data as { guestMessages?: GuestMessages; name?: string; waiter?: { name?: string } } | null | undefined;
  return { messages: t?.guestMessages ?? null, restaurant: t?.name ?? null, waiter: t?.waiter?.name || 'Pixie' };
}
