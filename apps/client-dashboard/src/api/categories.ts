/**
 * Categories API (per-user)
 * - List, create, update, delete
 * - Explicit Authorization header via token
 * - Uses shared DTOs for type safety
 */
import api from './auth';
import type { v1 } from '../../../../packages/shared/src/types';

export type Category = v1.CategoryDTO;

export async function getCategories(token: string): Promise<Category[]> {
  const res = await api.get('/api/v1/auth/categories', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.items as Category[];
}

export async function createCategory(name: string, token: string): Promise<Category> {
  const res = await api.post(
    '/api/v1/auth/categories',
    { name },
    { headers: { Authorization: `Bearer ${token}` } }
  );
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

export async function deleteCategory(id: string, token: string): Promise<void> {
  await api.post(
    `/api/v1/auth/categories/${encodeURIComponent(id)}/delete`,
    null,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}