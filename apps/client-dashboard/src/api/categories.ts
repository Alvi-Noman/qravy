/**
 * Categories API (per-user)
 * - List, create, update, delete
 * - Bulk per-branch/per-channel visibility
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type Channel = 'dine-in' | 'online';
export type Category = v1.CategoryDTO;

export async function getCategories(
  token: string,
  opts?: { locationId?: string; channel?: Channel }
): Promise<Category[]> {
  const params = new URLSearchParams();
  if (opts?.locationId) params.set('locationId', opts.locationId);
  if (opts?.channel) params.set('channel', opts.channel);

  const url = '/api/v1/auth/categories' + (params.toString() ? `?${params.toString()}` : '');

  const res = await api.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.items as Category[];
}

export async function createCategory(
  name: string,
  token: string,
  opts?: {
    locationId?: string;              // branch-scoped category
    channel?: Channel;                // 'dine-in' | 'online' (omit => both)
    includeLocationIds?: string[];    // global: visible only at these branches
    excludeLocationIds?: string[];    // global: hide at these branches
  }
): Promise<Category> {
  const uniq = (arr?: string[]) => Array.from(new Set((arr ?? []).filter(Boolean)));
  const include = uniq(opts?.includeLocationIds);
  const exclude = uniq(opts?.excludeLocationIds);

  const body: any = { name };
  if (opts?.locationId) body.locationId = opts.locationId;
  if (opts?.channel) body.channel = opts.channel;

  // Only send one of include/exclude (prefer include when both provided)
  if (include.length) body.includeLocationIds = include;
  else if (exclude.length) body.excludeLocationIds = exclude;

  const res = await api.post('/api/v1/auth/categories', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as Category;
}

export async function updateCategory(id: string, name: string, token: string): Promise<Category> {
  const res = await api.post(
    `/api/v1/auth/categories/${encodeURIComponent(id)}/update`,
    { name },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as Category;
}

// Scoped delete: optional locationId/channel as query params
export async function deleteCategory(
  id: string,
  token: string,
  scope?: { locationId?: string; channel?: Channel }
): Promise<void> {
  const params = new URLSearchParams();
  if (scope?.locationId) params.set('locationId', scope.locationId);
  if (scope?.channel) params.set('channel', scope.channel);
  const qs = params.toString();
  const url = `/api/v1/auth/categories/${encodeURIComponent(id)}/delete${qs ? `?${qs}` : ''}`;

  await api.post(url, null, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Bulk category visibility per-branch/per-channel
 * visible=false => hide category at the specified scope
 * visible=true  => remove overlays (back to baseline visible)
 */
export type BulkVisibilityResult = {
  matchedCount: number;
  modifiedCount: number;
  items: Category[];
};

export async function bulkSetCategoryVisibility(
  ids: string[],
  visible: boolean,
  token: string,
  locationId?: string,
  channel?: Channel
): Promise<BulkVisibilityResult> {
  const body: any = { ids, visible };
  if (locationId) body.locationId = locationId;
  if (channel) body.channel = channel;

  const res = await api.post('/api/v1/auth/categories/bulk/visibility', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data as BulkVisibilityResult;
}