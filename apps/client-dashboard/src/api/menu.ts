/**
 * Menu API (per-user)
 * - List and create products for the authenticated user
 * - Uses the shared axios instance (Authorization header via interceptor)
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

export async function getMenuItems(): Promise<MenuItem[]> {
  const res = await api.get('/api/v1/auth/menu-items');
  const items = res.data.items as any[];
  return items.map(mapItem);
}

export async function createMenuItem(payload: NewMenuItem): Promise<MenuItem> {
  const res = await api.post('/api/v1/auth/menu-items', payload);
  return mapItem(res.data.item);
}