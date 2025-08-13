/**
 * Categories API (per-user)
 * - List, create, update, delete
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
  return (res.data.items as any[]).map(mapCategory);
}

export async function createCategory(name: string, token: string): Promise<Category> {
  const res = await api.post(
    '/api/v1/auth/categories',
    { name },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return mapCategory(res.data.item);
}

export async function updateCategory(id: string, name: string, token: string): Promise<Category> {
  const res = await api.post(
    `/api/v1/auth/categories/${encodeURIComponent(id)}/update`,
    { name },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return mapCategory(res.data.item);
}

export async function deleteCategory(id: string, token: string): Promise<void> {
  await api.post(
    `/api/v1/auth/categories/${encodeURIComponent(id)}/delete`,
    null,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}