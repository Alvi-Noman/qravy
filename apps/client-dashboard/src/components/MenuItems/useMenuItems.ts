/**
 * Menu items hooks with optimistic updates where appropriate.
 * Loader is shown only for delete and assign-category. Category rows update after loader completes.
 * Uses a minimum 1200ms delay for those operations to align with the visual loader.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import {
  getMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  bulkUpdateAvailability,
  bulkDeleteMenuItems,
  bulkChangeCategoryApi,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import { getCategories, type Category } from '../../api/categories';
import { useProgress } from '../../context/ProgressContext';
import { toastSuccess, toastError } from '../Toaster';

/** Broadcast storage flags for tabs syncing */
function broadcast() {
  try {
    localStorage.setItem('menu:updated', String(Date.now()));
    localStorage.setItem('categories:updated', String(Date.now()));
  } catch {}
}

function httpStatus(err: any): number | undefined {
  return err?.response?.status ?? err?.status;
}
function shouldRetry(failures: number, err: any) {
  return httpStatus(err) === 429 && failures < 3;
}
function retryDelay(attempt: number) {
  const base = Math.min(1000 * 2 ** attempt, 5000);
  return base + Math.floor(Math.random() * 300);
}

/** Ensure a promise takes at least ms milliseconds */
function minDelay<T>(p: Promise<T>, ms = 1200): Promise<T> {
  return Promise.all([p, new Promise((r) => setTimeout(r, ms))]).then(([res]) => res as T);
}

type BulkAvailRes = { items: TMenuItem[]; matchedCount: number; modifiedCount: number };
type BulkDeleteRes = { ids: string[]; deletedCount: number };
type BulkCategoryRes = { items: TMenuItem[]; matchedCount: number; modifiedCount: number };

export function useMenuItems() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const enabled = !!token;
  const { start, done } = useProgress();
  const MIN_MS = 1200;

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
    enabled,
  });

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled,
  });

  const items = itemsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  const createMut = useMutation({
    mutationFn: async (payload: NewMenuItem) => {
      const price =
        typeof (payload as any).price === 'string'
          ? parseFloat((payload as any).price)
          : (payload as any).price;
      return minDelay(createMenuItem({ ...payload, price } as NewMenuItem, token as string), MIN_MS);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) => [...(prev ?? []), created]);
      toastSuccess('Product added');
      broadcast();
    },
    onError: (e: any) => {
      toastError(e?.message || 'Failed to add product');
    },
  });

  const updateMut = useMutation<
    TMenuItem,
    Error,
    { id: string; payload: Partial<NewMenuItem> },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ id, payload }) => {
      if ((payload as any).price != null && typeof (payload as any).price === 'string') {
        (payload as any).price = parseFloat((payload as any).price);
      }
      return minDelay(updateMenuItem(id, payload, token as string), MIN_MS);
    },
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (it.id === id ? ({ ...it, ...payload } as TMenuItem) : it))
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to update product');
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (it.id === updated.id ? updated : it))
      );
      toastSuccess('Product updated');
      broadcast();
    },
  });

  const availabilityMut = useMutation<
    TMenuItem,
    Error,
    { id: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ id, active }) =>
      updateMenuItem(
        id,
        active ? { hidden: false, status: 'active' } : { hidden: true, status: 'hidden' },
        token as string
      ),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) =>
          it.id === id ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem) : it
        )
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSuccess: () => {
      broadcast();
    },
  });

  const deleteMut = useMutation<void, Error, { id: string }, { snapshot: TMenuItem[] }>({
    mutationFn: ({ id }) => minDelay(deleteMenuItem(id, token as string), MIN_MS),
    onMutate: async ({ id }) => {
      start();
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).filter((it) => it.id !== id)
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to delete product');
    },
    onSuccess: () => {
      toastSuccess('Product deleted');
      broadcast();
    },
    onSettled: () => {
      done();
    },
  });

  const duplicateMut = useMutation({
    mutationFn: async (id: string) => {
      const it = items.find((x) => x.id === id);
      if (!it) throw new Error('Item not found');
      const copyName = `${it.name} (Copy)`;
      return createMenuItem(
        {
          name: copyName,
          price: (it as any).price,
          category: it.category,
          description: it.description,
        } as NewMenuItem,
        token as string
      );
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) => [...(prev ?? []), created]);
      broadcast();
    },
  });

  const bulkAvailabilityMut = useMutation<
    BulkAvailRes,
    Error,
    { ids: string[]; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ ids, active }) => bulkUpdateAvailability(ids, active, token as string),
    onMutate: async ({ ids, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) =>
          ids.includes(it.id)
            ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
            : it
        )
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSuccess: (res) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) => {
        const map = new Map((prev ?? []).map((it) => [it.id, it]));
        res.items.forEach((u: TMenuItem) => map.set(u.id, u));
        return Array.from(map.values());
      });
      broadcast();
    },
    retry: shouldRetry,
    retryDelay,
  });

  const bulkDeleteMut = useMutation<
    BulkDeleteRes,
    Error,
    { ids: string[] },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ ids }) => minDelay(bulkDeleteMenuItems(ids, token as string), MIN_MS),
    onMutate: async ({ ids }) => {
      start();
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).filter((it) => !ids.includes(it.id))
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSuccess: () => {
      broadcast();
    },
    onSettled: () => {
      done();
    },
    retry: shouldRetry,
    retryDelay,
  });

  const bulkCategoryMut = useMutation<
    BulkCategoryRes,
    Error,
    { ids: string[]; category?: string; categoryId?: string },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ ids, category, categoryId }) =>
      minDelay(bulkChangeCategoryApi(ids, category, categoryId, token as string), MIN_MS),
    onMutate: async () => {
      start();
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSuccess: (res) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) => {
        const map = new Map((prev ?? []).map((it) => [it.id, it]));
        res.items.forEach((u: TMenuItem) => map.set(u.id, u));
        return Array.from(map.values());
      });
      broadcast();
    },
    onSettled: () => {
      done();
    },
    retry: shouldRetry,
    retryDelay,
  });

  return {
    itemsQuery,
    categoriesQuery,
    items,
    categories,
    categoryNames,
    createMut,
    updateMut,
    deleteMut,
    duplicateMut,
    availabilityMut,
    bulkAvailabilityMut,
    bulkDeleteMut,
    bulkCategoryMut,
  };
}