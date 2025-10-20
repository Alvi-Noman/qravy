import axios from 'axios';
import type { v1 } from '../../../../packages/shared/src/types';

const baseURL =
  (typeof window !== 'undefined' && window.__STORE__?.apiBase) || '/api/v1';

const api = axios.create({
  baseURL,
  withCredentials: true,
});

export type Channel = 'dine-in' | 'online';

export type ListQuery = {
  /** Tenant subdomain, e.g. "demo". If provided, uses the public endpoints. */
  subdomain?: string;
  /** Optional branch/slug (location) for that tenant. */
  branch?: string;
  /** Channel filter */
  channel?: Channel;
  /** Legacy param for internal/admin views (ignored for public endpoints) */
  locationId?: string;
};

/* ---------------------------------- MENU ---------------------------------- */

// Overloads: keep old signature (channel, locationId) working
export function listMenu(channel?: Channel, locationId?: string): Promise<v1.MenuItemDTO[]>;
export function listMenu(query?: ListQuery): Promise<v1.MenuItemDTO[]>;
export async function listMenu(
  a?: Channel | ListQuery,
  b?: string
): Promise<v1.MenuItemDTO[]> {
  // Normalize args
  const query: ListQuery =
    typeof a === 'string' || a === undefined
      ? { channel: a as Channel | undefined, locationId: b }
      : (a ?? {});

  // Build params
  const params: Record<string, string> = {};
  if (query.channel) params.channel = query.channel;
  if (query.locationId) params.locationId = query.locationId;

  // If subdomain (or branch) provided, hit public menu
  if (query.subdomain || query.branch) {
    if (query.subdomain) params.subdomain = query.subdomain;
    if (query.branch) params.branch = query.branch;
    const { data } = await api.get('/public/menu', { params });
    return data.items as v1.MenuItemDTO[];
  }

  // Fallback to private/admin endpoint (current behavior)
  const { data } = await api.get('/auth/menu-items', { params });
  return data.items as v1.MenuItemDTO[];
}

/* ------------------------------- CATEGORIES ------------------------------- */

// Overloads: keep old signature (channel, locationId) working
export function listCategories(channel?: Channel, locationId?: string): Promise<v1.CategoryDTO[]>;
export function listCategories(query?: ListQuery): Promise<v1.CategoryDTO[]>;
export async function listCategories(
  a?: Channel | ListQuery,
  b?: string
): Promise<v1.CategoryDTO[]> {
  // Normalize args
  const query: ListQuery =
    typeof a === 'string' || a === undefined
      ? { channel: a as Channel | undefined, locationId: b }
      : (a ?? {});

  const params: Record<string, string> = {};
  if (query.channel) params.channel = query.channel;
  if (query.locationId) params.locationId = query.locationId;

  // If subdomain (or branch) provided, hit public categories (if/when you add it)
  if (query.subdomain || query.branch) {
    if (query.subdomain) params.subdomain = query.subdomain;
    if (query.branch) params.branch = query.branch;
    // If you haven't implemented this on the backend yet, you can comment this out
    // or keep it ready for when /public/categories is available.
    const { data } = await api.get('/public/categories', { params });
    return data.items as v1.CategoryDTO[];
  }

  // Fallback to private/admin endpoint (current behavior)
  const { data } = await api.get('/auth/categories', { params });
  return data.items as v1.CategoryDTO[];
}
