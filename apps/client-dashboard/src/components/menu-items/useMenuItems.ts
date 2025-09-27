// apps/client-dashboard/src/components/menu-items/useMenuItems.ts

/**
 * Menu items hooks with optimistic updates where appropriate.
 * Real-time availability: cache-first updates (no visible refresh).
 * We update all relevant caches (all/dine-in/online + indicators) for the current location.
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
  const { activeLocationId, channel } = useScope();
  const queryClient = useQueryClient();
  const enabled = !!token;
  const { start, done } = useProgress();
  const MIN_MS = 1200;

  // Resolve location for first render to avoid "all items" flash
  const persistedLocationId =
    typeof window !== 'undefined' ? localStorage.getItem('scope:activeLocationId') : null;
  const sessionLocationId = session?.locationId || null;
  const locationIdForQuery = activeLocationId ?? persistedLocationId ?? sessionLocationId ?? undefined;
  const lidKey = locationIdForQuery || 'all';

  // Channel resolution: undefined means "All channels"
  const channelForQuery = channel !== 'all' ? channel : undefined;
  const chanKey = channelForQuery || 'all';

  // Helper: update every menu-items cache for this location (lists + indicator queries)
  function patchAllLocationCaches(updater: (arr: TMenuItem[]) => TMenuItem[]) {
    const keys: Array<ReadonlyArray<any>> = [
      ['menu-items', token, lidKey, 'all'],
      ['menu-items', token, lidKey, 'dine-in'],
      ['menu-items', token, lidKey, 'online'],
      // dot indicator queries
      ['menu-items', token, lidKey, 'dine-in', 'indicator'],
      ['menu-items', token, lidKey, 'online', 'indicator'],
      // current channel view
      ['menu-items', token, lidKey, chanKey],
    ];

    for (const key of keys) {
      queryClient.setQueryData<TMenuItem[]>(key as any, (prev) => (prev ? updater(prev) : prev));
    }
  }

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token, lidKey, chanKey],
    queryFn: () => getMenuItems(token as string, { locationId: locationIdForQuery, channel: channelForQuery }),
    enabled,
    placeholderData: undefined, // Avoid showing previous channel data during refetch
  });

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token, lidKey, chanKey],
    queryFn: () => getCategories(token as string, { locationId: locationIdForQuery, channel: channelForQuery }),
    enabled,
    placeholderData: undefined,
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

      // Seed scope + channel for creation
      const withScope: NewMenuItem = {
        ...payload,
        price,
        ...(locationIdForQuery && session?.type !== 'central' ? { locationId: locationIdForQuery } : {}),
        ...(channelForQuery ? { channel: channelForQuery } : {}), // All channels -> omit so server seeds both
      };

      return minDelay(createMenuItem(withScope, token as string), MIN_MS);
    },
    onSuccess: (created) => {
      // Update current view immediately; other channel/all views will refetch on navigation
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, lidKey, chanKey],
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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey], (prev) =>
        (prev ?? []).map((it) => (it.id === id ? ({ ...it, ...payload } as TMenuItem) : it))
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to update product');
    },
    onSuccess: (updated) => {
      // Also update the other caches for consistency
      patchAllLocationCaches((arr) => arr.map((it) => (it.id === updated.id ? updated : it)));
      toastSuccess('Product updated');
      broadcast();
    },
  });

  // Real-time single-item availability toggle (no refetch)
  const availabilityMut = useMutation<
    TMenuItem[],
    Error,
    { id: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ id, active }) => {
      const res = await bulkUpdateAvailability(
        [id],
        active,
        token as string,
        locationIdForQuery || undefined,
        channelForQuery || undefined
      );
      return res.items;
    },
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });

      const apply = (arr: TMenuItem[]) =>
        arr.map((it) =>
          it.id === id ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem) : it
        );

      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      // Optimistic across all caches for this location (lists + indicators)
      patchAllLocationCaches(apply);
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
      if (e instanceof Error) toastError(e.message);
    },
    onSuccess: () => {
      // Caches already updated — no invalidate/refetch needed
      broadcast();
    },
  });

  const deleteMut = useMutation<void, Error, { id: string }, { snapshot: TMenuItem[] }>({
    mutationFn: ({ id }) => minDelay(deleteMenuItem(id, token as string), MIN_MS),
    onMutate: async ({ id }) => {
      start();
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      // Remove across all caches for this location
      patchAllLocationCaches((arr) => arr.filter((it) => it.id !== id));
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
      toastError((e as any)?.message || 'Failed to delete product');
    },
    onSuccess: () => {
      const remaining = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
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
  });

  const duplicateMut = useMutation({
    mutationFn: async (id: string) => {
      const it = items.find((x) => x.id === id);
      if (!it) throw new Error('Item not found');
      const copyName = `${it.name} (Copy)`;
      const payload: NewMenuItem = {
        name: copyName,
        price: (it as any).price,
        category: it.category,
        description: it.description,
        ...(locationIdForQuery && session?.type !== 'central' ? { locationId: locationIdForQuery } : {}),
        ...(channelForQuery ? { channel: channelForQuery } : {}),
      };
      return createMenuItem(payload, token as string);
    },
    onSuccess: (created) => {
      // Add to current view; optional: also add to other caches if needed
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, lidKey, chanKey],
        (prev) => [...(prev ?? []), created]
      );
      broadcast();
    },
  });

  // Real-time bulk availability (no refetch)
  const bulkAvailabilityMut = useMutation<
    BulkAvailRes,
    Error,
    { ids: string[]; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ ids, active }) =>
      bulkUpdateAvailability(
        ids,
        active,
        token as string,
        locationIdForQuery || undefined,
        channelForQuery || undefined
      ),
    onMutate: async ({ ids, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });

      const apply = (arr: TMenuItem[]) =>
        arr.map((it) =>
          ids.includes(it.id)
            ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
            : it
        );

      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      patchAllLocationCaches(apply);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
    },
    onSuccess: () => {
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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      patchAllLocationCaches((arr) => arr.filter((it) => !ids.includes(it.id)));
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
    },
    onSuccess: () => {
      const remaining = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
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
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, lidKey, chanKey] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, lidKey, chanKey]) ?? [];
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, lidKey, chanKey], ctx.snapshot);
    },
    onSuccess: (res) => {
      // Merge returned items into all caches
      const updatedById = new Map(res.items.map((u) => [u.id, u]));
      patchAllLocationCaches((arr) => arr.map((it) => updatedById.get(it.id) ?? it));
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