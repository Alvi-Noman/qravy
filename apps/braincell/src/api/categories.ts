/**
 * Categories API (per-user)
 * - List, create, update, delete
 * - Bulk per-branch/per-channel visibility
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type Channel = 'dine-in' | 'online';
export type Category = v1.CategoryDTO;

/** Extra fields we rely on to enforce Advanced UI rules */
export type CategoryDetail = Category & {
  /** Category is limited to one channel (if present); omit => both */
  channel?: Channel;
  /** Global category: visible only at these branches */
  includeLocationIds?: string[];
  /** Global category: hidden at these branches */
  excludeLocationIds?: string[];
};

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

/**
 * Fetch a single category by exact name so the UI can read its baseline rules
 * (channel-only category, include/exclude branches) and disable Advanced toggles.
 * Returns null if not found.
 */
export async function getCategoryByName(name: string, token: string): Promise<CategoryDetail | null> {
  const res = await api.get('/api/v1/auth/categories', {
    headers: { Authorization: `Bearer ${token}` },
    params: { name },
  });
  const items = (res.data?.items ?? []) as CategoryDetail[];
  return items.find((c) => c.name === name) ?? null;
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

  const body: any = { name };

  // Branch scope (mutually exclusive with include/exclude seeding)
  if (opts?.locationId) body.locationId = opts.locationId;
  if (opts?.channel) body.channel = opts.channel;

  // Only seed include/exclude for GLOBAL categories
  if (!opts?.locationId) {
    const include = uniq(opts?.includeLocationIds);
    const exclude = uniq(opts?.excludeLocationIds);
    if (include.length) body.includeLocationIds = include;
    else if (exclude.length) body.excludeLocationIds = exclude;
  }

  const res = await api.post('/api/v1/auth/categories', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as Category;
}

/**
 * Update a category.
 *
 * Backward-compatible overloads:
 *  - Legacy rename (current callers): updateCategory(id, name, token, opts?)
 *  - Advanced patch only:           updateCategory(id, token, patch)
 *
 * Patch fields:
 *  - name?: string
 *  - channel?: 'dine-in' | 'online' | 'both'  (explicit 'both' widens to both channels)
 *  - includeLocationIds?: string[]
 *  - excludeLocationIds?: string[]
 *  - hardExclude?: boolean
 */
export async function updateCategory(
  id: string,
  a: string,
  b?: string | {
    channel?: Channel | 'both';
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
    hardExclude?: boolean;
  },
  c?: {
    channel?: Channel | 'both';
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
    hardExclude?: boolean;
  }
): Promise<Category> {
  // Overload resolution
  let token: string;
  let name: string | undefined;
  let opts:
    | {
        channel?: Channel | 'both';
        includeLocationIds?: string[];
        excludeLocationIds?: string[];
        hardExclude?: boolean;
      }
    | undefined;

  if (typeof b === 'string') {
    // Signature: (id, name, token, opts?)
    name = a;
    token = b;
    opts = c;
  } else {
    // Signature: (id, token, patch)
    token = a;
    opts = b;
    name = opts && (opts as any).name; // allow passing name inside patch if desired
  }

  const uniq = (arr?: string[]) => Array.from(new Set((arr ?? []).filter(Boolean)));

  const body: any = {};
  const trimmed = (name ?? '').trim();
  if (trimmed) body.name = trimmed;

  // IMPORTANT: If caller provided channel (including 'both'), send it explicitly.
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'channel')) {
    body.channel = opts.channel;
  }

  const include = uniq(opts?.includeLocationIds);
  const exclude = uniq(opts?.excludeLocationIds);
  if (include.length) body.includeLocationIds = include;
  if (exclude.length) body.excludeLocationIds = exclude;

  if (typeof opts?.hardExclude === 'boolean') {
    body.hardExclude = opts.hardExclude;
  }

  const res = await api.post(
    `/api/v1/auth/categories/${encodeURIComponent(id)}/update`,
    body,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.item as Category;
}

/**
 * DELETE category with optional scope via query params.
 * Use HTTP DELETE (no JSON body) to avoid proxies hanging on POST with empty body.
 */
export async function deleteCategory(
  id: string,
  token: string,
  scope?: { locationId?: string; channel?: Channel }
): Promise<void> {
  const params: Record<string, string> = {};
  if (scope?.locationId) params.locationId = scope.locationId;
  if (scope?.channel) params.channel = scope.channel;

  await api.delete(`/api/v1/auth/categories/${encodeURIComponent(id)}/delete`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
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
  channel?: Channel,
  hardExclude?: boolean
): Promise<BulkVisibilityResult> {
  const body: any = { ids, visible };
  if (locationId) body.locationId = locationId;
  if (channel) body.channel = channel;
  if (typeof hardExclude === 'boolean') body.hardExclude = hardExclude;

  const res = await api.post('/api/v1/auth/categories/bulk/visibility', body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data as BulkVisibilityResult;
}
