// apps/tastebud/src/hooks/usePublicMenu.ts
import { useQuery } from '@tanstack/react-query';
import { listMenu, type Channel } from '../api/storefront';
import type { v1 } from '../../../../packages/shared/src/types';

/** The dish's picture: the menu keeps its photos in `media` (a list) — the first one is the dish's picture. Every
 *  item comes back with `imageUrl` set from it, so the waiter's cards, tray picks and offers all show it. */
function withImage(it: any): any {
  if (!it || it.imageUrl) return it;
  const first = Array.isArray(it.media) ? it.media.find((m: unknown) => typeof m === 'string' && m) : undefined;
  const url = first || (typeof it.image === 'string' ? it.image : undefined);
  return url ? { ...it, imageUrl: url } : it;
}

export function usePublicMenu(subdomain?: string, branch?: string, channel?: Channel) {
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['publicMenu', { subdomain, branch, channel }],
    enabled: Boolean(subdomain),
    queryFn: async () => ((await listMenu({ subdomain: subdomain!, branch, channel })) as any[]).map(withImage),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return { items: items as v1.MenuItemDTO[], isLoading, isError };
}
