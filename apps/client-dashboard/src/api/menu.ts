/**
 * Menu API (per-user)
 * Sends full product payload including media, variations, and tags
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type VariationInput = {
  name: string;
  price?: number;
  imageUrl?: string;
};

export type NewMenuItem = {
  name: string;
  price: number;
  compareAtPrice?: number;
  description?: string;
  category?: string;
  categoryId?: string;
  media?: string[];
  variations?: VariationInput[];
  tags?: string[];
  restaurantId?: string;
};

export type MenuItem = v1.MenuItemDTO;

export async function getMenuItems(token: string): Promise<MenuItem[]> {
  const res = await api.get('/api/v1/auth/menu-items', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.items as MenuItem[];
}

export async function createMenuItem(payload: NewMenuItem, token: string): Promise<MenuItem> {
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
  const res = await api.post(`/api/v1/auth/menu-items/${encodeURIComponent(id)}/update`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.item as MenuItem;
}

export async function deleteMenuItem(id: string, token: string): Promise<void> {
  await api.post(`/api/v1/auth/menu-items/${encodeURIComponent(id)}/delete`, null, {
    headers: { Authorization: `Bearer ${token}` },
  });
}