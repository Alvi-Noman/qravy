/**
 * Menu API (per-user)
 * - List, create, update (POST), delete (POST) products
 * - Accept a token to guarantee Authorization header
 * - Uses shared DTOs for type safety
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type NewMenuItem = {
  name: string;
  price: number;
  description?: string;
  category?: string;
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