/**
 * Categories API (per-user)
 * - List and create categories
 * - Explicit Authorization header via token
 */
import api from './auth';

export type Category = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

function mapCategory(d: any): Category {
  return {
    id: d.id ?? d._id?.toString?.() ?? String(d._id),
    name: d.name,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date(d.createdAt).toISOString(),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(d.updatedAt).toISOString(),
  };
}

export async function getCategories(token: string): Promise<Category[]> {
  const res = await api.get('/api/v1/auth/categories', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const items = res.data.items as any[];
  return items.map(mapCategory);
}

export async function createCategory(name: string, token: string): Promise<Category> {
  const res = await api.post(
    '/api/v1/auth/categories',
    { name },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return mapCategory(res.data.item);
}