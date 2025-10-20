import axios from 'axios';
import type { v1 } from '../../../../packages/shared/src/types';

const baseURL =
  (typeof window !== 'undefined' && window.__STORE__?.apiBase) || '/api/v1';

const api = axios.create({
  baseURL,
  withCredentials: true,
});

export type Channel = 'dine-in' | 'online';

export async function listMenu(channel?: Channel, locationId?: string) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/auth/menu-items', { params });
  return data.items as v1.MenuItemDTO[];
}

export async function listCategories(channel?: Channel, locationId?: string) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (locationId) params.locationId = locationId;
  const { data } = await api.get('/auth/categories', { params });
  return data.items as v1.CategoryDTO[];
}
