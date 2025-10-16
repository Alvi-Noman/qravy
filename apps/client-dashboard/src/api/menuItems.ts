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
  locationId?: string;
  includeLocationIds?: string[];
  excludeLocationIds?: string[];

  // Channel seed
  channel?: Channel;

  // Channel exclusion controls
  excludeChannel?: Channel;                 // exclude globally
  excludeAtLocationIds?: string[];          // exclude at these locations (both channels)
  excludeChannelAt?: Channel;               // which channel to exclude at locations
  excludeChannelAtLocationIds?: string[];   // locations for that channel exclusion
};

export type MenuItem = v1.MenuItemDTO;

export async function getMenuItems(
  token: string,
  opts?: { locationId?: string; channel?: Channel }
): Promise<MenuItem[]> {
  const params = new URLSearchParams();
  if (opts?.locationId) params.set('locationId', opts.locationId);
  if (opts?.channel) params.set('channel', opts.channel);
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
  // ---- Normalization block ----
  const normalized: NewMenuItem = (() => {
    const p = { ...payload };

    const noLocTargets =
      !p.locationId &&
      (!p.includeLocationIds || p.includeLocationIds.length === 0) &&
      (!p.excludeLocationIds || p.excludeLocationIds.length === 0) &&
      (!p.excludeAtLocationIds || p.excludeAtLocationIds.length === 0) &&
      (!p.excludeChannelAtLocationIds || p.excludeChannelAtLocationIds.length === 0);

    // collapse per-location exclusion → global exclusion if no loc targets
    if (!p.excludeChannel && p.excludeChannelAt && noLocTargets) {
      p.excludeChannel = p.excludeChannelAt as Channel;
      delete (p as any).excludeChannelAt;
      delete (p as any).excludeChannelAtLocationIds;
    }

    // don’t send channel if it equals excluded one
    if (p.excludeChannel && p.channel === p.excludeChannel) {
      delete p.channel;
    }

    return p;
  })();

  // 👇 proof log
  console.log('[API createMenuItem] normalized payload:', normalized);

  const res = await api.post('/api/v1/auth/menu-items', normalized, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as MenuItem;
}

/** ✅ Update menu item */
export async function updateMenuItem(
  id: string,
  payload: Partial<NewMenuItem>,
  token: string
): Promise<MenuItem> {
  console.log('[API updateMenuItem] payload:', payload);
  const res = await api.post(
    `/api/v1/auth/menu-items/${encodeURIComponent(id)}/update`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as MenuItem;
}

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

  console.log('[API deleteMenuItem] scope:', scope);

  await api.post(url, null, { headers: { Authorization: `Bearer ${token}` } });
}

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

  console.log('[API bulkUpdateAvailability] body:', body);

  const res = await api.post('/api/v1/auth/menu-items/bulk/availability', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data as { items: MenuItem[]; matchedCount: number; modifiedCount: number };
}

export async function bulkDeleteMenuItems(
  payload: { ids: string[]; locationId?: string; channel?: Channel },
  token: string
): Promise<{ deletedCount: number; ids: string[] }> {
  console.log('[API bulkDeleteMenuItems] payload:', payload);

  const res = await api.post(
    '/api/v1/auth/menu-items/bulk/delete',
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data as { deletedCount: number; ids: string[] };
}

export async function bulkChangeCategoryApi(
  ids: string[],
  category: string | undefined,
  categoryId: string | undefined,
  token: string
): Promise<{ items: MenuItem[]; matchedCount: number; modifiedCount: number }> {
  const body = { ids, category, categoryId };
  console.log('[API bulkChangeCategoryApi] body:', body);

  const res = await api.post(
    '/api/v1/auth/menu-items/bulk/category',
    body,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data as { items: MenuItem[]; matchedCount: number; modifiedCount: number };
}
