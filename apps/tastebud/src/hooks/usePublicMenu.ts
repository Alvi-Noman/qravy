// apps/tastebud/src/hooks/usePublicMenu.ts
import { useQuery } from '@tanstack/react-query';
import { listMenu, type Channel } from '../api/storefront';
import type { v1 } from '../../../../packages/shared/src/types';

export function usePublicMenu(subdomain?: string, branch?: string, channel?: Channel) {
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: ['publicMenu', { subdomain, branch, channel }],
    enabled: Boolean(subdomain),
    queryFn: () =>
      listMenu({ subdomain: subdomain!, branch, channel }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return { items: items as v1.MenuItemDTO[], isLoading, isError };
}
