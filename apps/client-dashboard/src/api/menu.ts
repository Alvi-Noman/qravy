/**
 * Menu API (per-user)
 * - List, create, update (POST), delete (POST) products
 * - Accept a token to guarantee Authorization header
 */
import api from './auth';

export type NewMenuItem = {
  name: string;
  price: number;
  description?: string;
  category?: string;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
};

function mapItem(d: any): MenuItem {
  return {
    id: d.id ?? d._id?.toString?.() ?? String(d._id),
    name: d.name,
    price: d.price,
    description: d.description,
    category: d.category,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(d.createdAt).toISOString(),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(d.updatedAt).toISOString(),
  };
}

export async function getMenuItems(token: string): Promise<MenuItem[]> {
  const res = await api.get('/api/v1/auth/menu-items', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (res.data.items as any[]).map(mapItem);
}

export async function createMenuItem(payload: NewMenuItem, token: string): Promise<MenuItem> {
  const res = await api.post('/api/v1/auth/menu-items', payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return mapItem(res.data.item);
}

export async function updateMenuItem(
  id: string,
  payload: Partial<NewMenuItem>,
  token: string
): Promise<MenuItem> {
  const res = await api.post(`/api/v1/auth/menu-items/${encodeURIComponent(id)}/update`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return mapItem(res.data.item);
}

export async function deleteMenuItem(id: string, token: string): Promise<void> {
  await api.post(`/api/v1/auth/menu-items/${encodeURIComponent(id)}/delete`, null, {
    headers: { Authorization: `Bearer ${token}` },
  });
}