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
} from '../../api/menuItems';
import { getCategories, type Category } from '../../api/categories';
import { useProgress } from '../../context/ProgressContext';
import { toastSuccess, toastError } from '../Toaster';
import type { TenantDTO } from '../../../../../packages/shared/src/types/v1';
import { useScope } from '../../context/ScopeContext';

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
  const { token, session } = useAuthContext();
  const { activeLocationId } = useScope();
  const queryClient = useQueryClient();
  const enabled = !!token;
  const { start, done } = useProgress();
  const MIN_MS = 1200;

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token, activeLocationId || 'all'],
    queryFn: () => getMenuItems(token as string, { locationId: activeLocationId || undefined }),
    enabled,
  });

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token, activeLocationId || 'all'],
    queryFn: () => getCategories(token as string, { locationId: activeLocationId || undefined }),
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

      // If a specific branch is selected (owner/admin), create as branch-only
      const withScope =
        activeLocationId && session?.type !== 'central'
          ? ({ ...payload, price, locationId: activeLocationId } as NewMenuItem)
          : ({ ...payload, price } as NewMenuItem);

      return minDelay(createMenuItem(withScope, token as string), MIN_MS);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, activeLocationId || 'all'],
        (prev) => [...(prev ?? []), created]
      );

      queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
        prev
          ? {
              ...prev,
              onboardingProgress: {
                hasCategory: prev.onboardingProgress?.hasCategory ?? false,
                hasMenuItem: true,
                checklist: prev.onboardingProgress?.checklist,
              },
            }
          : prev
      );
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).map((it) => (it.id === id ? ({ ...it, ...payload } as TMenuItem) : it))
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to update product');
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).map((it) => (it.id === updated.id ? updated : it))
      );
      toastSuccess('Product updated');
      broadcast();
    },
  });

  // Single-item availability toggle should be per-branch.
  // For owner/admin in "All", require selecting a branch first.
  const availabilityMut = useMutation<
    TMenuItem[],
    Error,
    { id: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ id, active }) => {
      if (!activeLocationId && session?.type !== 'central') {
        throw new Error('Select a location to toggle availability');
      }
      const res = await bulkUpdateAvailability([id], active, token as string, activeLocationId || undefined);
      return res.items;
    },
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).map((it) =>
          it.id === id ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem) : it
        )
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
      if (e instanceof Error) toastError(e.message);
    },
    onSuccess: (updatedItems) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) => {
        const map = new Map((prev ?? []).map((it) => [it.id, it]));
        updatedItems.forEach((u) => map.set(u.id, u));
        return Array.from(map.values());
      });
      broadcast();
    },
  });

  const deleteMut = useMutation<void, Error, { id: string }, { snapshot: TMenuItem[] }>({
    mutationFn: ({ id }) => minDelay(deleteMenuItem(id, token as string), MIN_MS),
    onMutate: async ({ id }) => {
      start();
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).filter((it) => it.id !== id)
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to delete product');
    },
    onSuccess: () => {
      const remaining = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      if (remaining.length === 0) {
        queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
          prev
            ? {
                ...prev,
                onboardingProgress: {
                  hasCategory: prev.onboardingProgress?.hasCategory ?? false,
                  hasMenuItem: false,
                  checklist: prev.onboardingProgress?.checklist,
                },
              }
            : prev
        );
      }
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

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
      // Keep duplication in the same scope as current selection
      const payload: NewMenuItem = {
        name: copyName,
        price: (it as any).price,
        category: it.category,
        description: it.description,
        ...(activeLocationId && session?.type !== 'central' ? { locationId: activeLocationId } : {}),
      };
      return createMenuItem(payload, token as string);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, activeLocationId || 'all'],
        (prev) => [...(prev ?? []), created]
      );
      broadcast();
    },
  });

  const bulkAvailabilityMut = useMutation<
    BulkAvailRes,
    Error,
    { ids: string[]; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ ids, active }) =>
      bulkUpdateAvailability(ids, active, token as string, activeLocationId || undefined),
    onMutate: async ({ ids, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).map((it) =>
          ids.includes(it.id)
            ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
            : it
        )
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
    },
    onSuccess: (res) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) => {
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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) =>
        (prev ?? []).filter((it) => !ids.includes(it.id))
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
    },
    onSuccess: () => {
      const remaining = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      if (remaining.length === 0) {
        queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
          prev
            ? {
                ...prev,
                onboardingProgress: {
                  hasCategory: prev.onboardingProgress?.hasCategory ?? false,
                  hasMenuItem: false,
                  checklist: prev.onboardingProgress?.checklist,
                },
              }
            : prev
        );
      }
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
    },
    onSuccess: (res) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all'], (prev) => {
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