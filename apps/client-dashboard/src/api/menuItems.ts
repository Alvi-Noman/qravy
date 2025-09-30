/**
 * Menu API (per-user)
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type Channel = 'dine-in' | 'online';

export type VariationInput = {
  name: string;
  price?: number;
  imageUrl?: string;
};

export type NewMenuItem = {
  name: string;
  price?: number;
  compareAtPrice?: number;
  description?: string;
  category?: string;
  categoryId?: string;
  media?: string[];
  variations?: VariationInput[];
  tags?: string[];
  restaurantId?: string;
  hidden?: boolean;
  status?: 'active' | 'hidden';

  // Branch scoping or targeting
  locationId?: string;              // create as branch-only item (single branch)
  includeLocationIds?: string[];    // global item: visible only in these branches
  excludeLocationIds?: string[];    // global item: visible everywhere except these branches

  // Channel seed when creating under a specific channel (omit for "All channels")
  channel?: Channel;
};

export type MenuItem = v1.MenuItemDTO;

export async function getMenuItems(
  token: string,
  opts?: { locationId?: string; channel?: Channel }
): Promise<MenuItem[]> {
  const params = new URLSearchParams();
  if (opts?.locationId) params.set('locationId', opts.locationId);
  if (opts?.channel) params.set('channel', opts.channel);
  // Cache-buster to avoid 304/ETag reuse while debugging
  params.set('_', String(Date.now()));

  const url = '/api/v1/auth/menu-items' + (params.toString() ? `?${params.toString()}` : '');

  const res = await api.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  return res.data.items as MenuItem[];
}

export async function createMenuItem(
  payload: NewMenuItem,
  token: string
): Promise<MenuItem> {
  const res = await api.post('/api/v1/auth/menu-items', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as MenuItem;
}

export async function updateMenuItem(
  id: string,
  payload: Partial<NewMenuItem>,
  token: string
): Promise<MenuItem> {
  const res = await api.post(
    `/api/v1/auth/menu-items/${encodeURIComponent(id)}/update`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as MenuItem;
}

// Scoped delete: optional locationId/channel as query params
export async function deleteMenuItem(
  id: string,
  token: string,
  scope?: { locationId?: string; channel?: Channel }
): Promise<void> {
  const params = new URLSearchParams();
  if (scope?.locationId) params.set('locationId', scope.locationId);
  if (scope?.channel) params.set('channel', scope.channel);
  const qs = params.toString();
  const url = `/api/v1/auth/menu-items/${encodeURIComponent(id)}/delete${qs ? `?${qs}` : ''}`;

  await api.post(url, null, { headers: { Authorization: `Bearer ${token}` } });
}

/** Bulk availability per-branch/per-channel */
export async function bulkUpdateAvailability(
  ids: string[],
  active: boolean,
  token: string,
  locationId?: string,
  channel?: Channel
): Promise<{ items: MenuItem[]; matchedCount: number; modifiedCount: number }> {
  const body: any = { ids, active };
  if (locationId) body.locationId = locationId;
  if (channel) body.channel = channel;

  const res = await api.post('/api/v1/auth/menu-items/bulk/availability', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data as { items: MenuItem[]; matchedCount: number; modifiedCount: number };
}

/** Bulk delete: supports optional scope in payload */
export async function bulkDeleteMenuItems(
  payload: { ids: string[]; locationId?: string; channel?: Channel },
  token: string
): Promise<{ deletedCount: number; ids: string[] }> {
  const res = await api.post(
    '/api/v1/auth/menu-items/bulk/delete',
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data as { deletedCount: number; ids: string[] };
}

/** Bulk category: returns updated items */
export async function bulkChangeCategoryApi(
  ids: string[],
  category: string | undefined,
  categoryId: string | undefined,
  token: string
): Promise<{ items: MenuItem[]; matchedCount: number; modifiedCount: number }> {
  const res = await api.post(
    '/api/v1/auth/menu-items/bulk/category',
    { ids, category, categoryId },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data as { items: MenuItem[]; matchedCount: number; modifiedCount: number };
}