// apps/braincell/src/components/menu-items/useMenuItems.ts

/**
 * Menu items hooks with optimistic, channel-aware updates (no visible refresh).
 * - Patch the affected channel caches
 * - Keep "All channels" list in sync
 * - Cross-scope patching: All locations <-> specific location
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

function broadcast() {
  try {
    if (typeof window !== 'undefined') {
      // Same-tab
      window.dispatchEvent(new CustomEvent('menu:updated'));
      window.dispatchEvent(new CustomEvent('categories:updated'));

      // Cross-tab (BroadcastChannel if available)
      try {
        const BC: any = (window as any).BroadcastChannel;
        if (BC) {
          const m = new BC('menu');
          m.postMessage({ type: 'updated', at: Date.now() });
          m.close?.();
          const c = new BC('categories');
          c.postMessage({ type: 'updated', at: Date.now() });
          c.close?.();
        }
      } catch {}
    }
    // Fallback cross-tab via localStorage
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
function minDelay<T>(p: Promise<T>, ms = 1200): Promise<T> {
  return Promise.all([p, new Promise((r) => setTimeout(r, ms))]).then(([res]) => res as T);
}
const plural = (n: number, s: string, p: string = s + 's') => `${n} ${n === 1 ? s : p}`;

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

  // Scope: only from ScopeContext
  const locationIdForQuery = activeLocationId ?? undefined;
  const lidKey = locationIdForQuery || 'all';
  const channelForQuery = channel !== 'all' ? channel : undefined;
  const chanKey = channelForQuery || 'all';

  // Keys for this scope
  const keyAll = ['menu-items', token, lidKey, 'all'] as const;
  const keyDineIn = ['menu-items', token, lidKey, 'dine-in'] as const;
  const keyOnline = ['menu-items', token, lidKey, 'online'] as const;
  const keyCurrent = ['menu-items', token, lidKey, chanKey] as const;
  const keyDIIndicator = ['menu-items', token, lidKey, 'dine-in', 'indicator'] as const;
  const keyONIndicator = ['menu-items', token, lidKey, 'online', 'indicator'] as const;

  // Global (All locations + All channels)
  const globalAllKey = ['menu-items', token, 'all', 'all'] as const;

  // Queries
  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: keyCurrent,
    queryFn: () => getMenuItems(token as string, { locationId: locationIdForQuery, channel: channelForQuery }),
    enabled,
    placeholderData: undefined,
    retry: shouldRetry,
    retryDelay,
  });
  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token, lidKey, chanKey],
    queryFn: () => getCategories(token as string, { locationId: locationIdForQuery, channel: channelForQuery }),
    enabled,
    placeholderData: undefined,
    retry: shouldRetry,
    retryDelay,
  });

  const items = itemsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  // Helpers
  const setRowState = (arr: TMenuItem[], id: string, active: boolean): TMenuItem[] =>
    arr.map((it) =>
      it.id === id ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem) : it
    );
  const setBulkRowState = (arr: TMenuItem[], ids: string[], active: boolean): TMenuItem[] =>
    arr.map((it) =>
      ids.includes(it.id) ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem) : it
    );

  function patchChannel(channelName: 'dine-in' | 'online', updater: (arr: TMenuItem[]) => TMenuItem[]) {
    const listKey = channelName === 'dine-in' ? keyDineIn : keyOnline;
    const indKey = channelName === 'dine-in' ? keyDIIndicator : keyONIndicator;
    queryClient.setQueryData<TMenuItem[]>(listKey as any, (prev) => (prev ? updater(prev) : prev));
    queryClient.setQueryData<TMenuItem[]>(indKey as any, (prev) => (prev ? updater(prev) : prev));
  }

  // Recompute 'all' row for a specific lid by reading its DI/ON caches
  function recomputeAllRowForLid(lid: string, id: string) {
    const kDI = ['menu-items', token, lid, 'dine-in'] as const;
    const kON = ['menu-items', token, lid, 'online'] as const;
    const kALL = ['menu-items', token, lid, 'all'] as const;
    const di = (queryClient.getQueryData<TMenuItem[]>(kDI as any) ?? []).find((x) => x.id === id);
    const on = (queryClient.getQueryData<TMenuItem[]>(kON as any) ?? []).find((x) => x.id === id);
    const diActive = di ? !(di.hidden || di.status === 'hidden') : undefined;
    const onActive = on ? !(on.hidden || on.status === 'hidden') : undefined;
    const newActive =
      diActive === true || onActive === true
        ? true
        : diActive === false && onActive === false
        ? false
        : undefined;
    if (newActive === undefined) return;
    queryClient.setQueryData<TMenuItem[]>(kALL as any, (prev) => (prev ? setRowState(prev, id, newActive) : prev));
  }

  // Removal helpers (hard-delete semantics for UI lists)
  const filterOutIds =
    (ids: string[]) =>
    (prev: TMenuItem[] | undefined): TMenuItem[] | undefined =>
      prev ? prev.filter((it) => !ids.includes(it.id)) : prev;
  const filterOutId =
    (id: string) =>
    (prev: TMenuItem[] | undefined): TMenuItem[] | undefined =>
      prev ? prev.filter((it) => it.id !== id) : prev;

  function removeFromAllCachesEverywhere(ids: string[]) {
    queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      queryClient.setQueryData<TMenuItem[]>(key as any, filterOutIds(ids));
    });
  }

  function removeFromChannelAcrossAllLids(chan: 'dine-in' | 'online', ids: string[]) {
    queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      const k = key as any[];
      const cacheChan = k[3] as string;
      const isIndicator = k[4] === 'indicator';
      if (cacheChan === chan || isIndicator) {
        queryClient.setQueryData<TMenuItem[]>(key as any, filterOutIds(ids));
      }
    });
    // Do not touch 'all' lists; the item may still exist via the other channel.
  }

  // NEW: invalidate all menu queries for a specific location (covers both channels + "all")
  function invalidateMenusForLid(lid: string) {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey as any[];
        return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token && k[2] === lid;
      },
    });
  }

  const itemsQueryKeyPrefix = ['menu-items', token] as const;

  // Mutations
  const createMut = useMutation({
    mutationFn: async (payload: NewMenuItem) => {
      const price =
        typeof (payload as any).price === 'string' ? parseFloat((payload as any).price) : (payload as any).price;

      // Respect drawer's Advanced channel selection only (no scope fallback)
      const chosenChannel = (payload as any).channel;

      const withScope: NewMenuItem = {
        ...payload,
        price,
        ...(activeLocationId && session?.type !== 'central' ? { locationId: activeLocationId } : {}),
        ...(chosenChannel ? { channel: chosenChannel } : {}),
      };

      return minDelay(createMenuItem(withScope, token as string), MIN_MS);
    },
    onSuccess: (created) => {
      // Only push into the current channel cache if the item should appear here by baseline visibility.
      const vis = (created as any)?.visibility || {};
      const showInCurrent =
        chanKey === 'all'
          ? true
          : chanKey === 'dine-in'
          ? vis.dineIn !== false // undefined -> treated as true
          : vis.online !== false;

      const isBranchView = !!activeLocationId;

      if (!isBranchView) {
        // Global view: safe to optimistically add
        if (showInCurrent) {
          queryClient.setQueryData<TMenuItem[]>(keyCurrent as any, (prev) => [...(prev ?? []), created]);
        }
      } else {
        // Branch/Location view: do NOT optimistically add, because per-location excludes
        // (excludeAtLocationIds / excludeChannelAtLocationIds) are applied server-side
        // and are not visible in the returned item DTO. Just refetch this list.
        queryClient.invalidateQueries({ queryKey: keyCurrent as any });
      }

      // Keep global all-locations + all-channels cache updated (list page can hydrate from here)
      queryClient.setQueryData<TMenuItem[]>(globalAllKey as any, (prev) => {
        if (!prev) return prev;
        return prev.some((x) => x.id === created.id) ? prev : [...prev, created];
      });

      // Invalidate "All locations" lists to reconcile cross-scope caches
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token && k[2] === 'all';
        },
      });

      toastSuccess('Product added');
      broadcast();
    },
    onError: (e: any) => toastError(e?.message || 'Failed to add product'),
  });

  const updateMut = useMutation<
    TMenuItem,
    Error,
    { id: string; payload: Partial<NewMenuItem> },
    { snapshot?: TMenuItem[] }
  >({
    mutationFn: async ({ id, payload }) => {
      if ((payload as any).price != null && typeof (payload as any).price === 'string') {
        (payload as any).price = parseFloat((payload as any).price);
      }
      return minDelay(updateMenuItem(id, payload, token as string), MIN_MS);
    },
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: keyCurrent });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(keyCurrent as any) ?? [];
      queryClient.setQueryData<TMenuItem[]>(keyCurrent as any, (prev) =>
        (prev ?? []).map((it) => (it.id === id ? ({ ...it, ...payload } as TMenuItem) : it))
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(keyCurrent as any, ctx.snapshot);
      toastError((e as any)?.message || 'Failed to update product');
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TMenuItem[]>(keyCurrent as any, (prev) =>
        (prev ?? []).map((it) => (it.id === updated.id ? updated : it))
      );
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token && k[2] === 'all';
        },
      });
      toastSuccess('Product updated');
      broadcast();
    },
  });

  // Single toggle (availability only; never removes rows)
  const availabilityMut = useMutation<
    TMenuItem[],
    Error,
    { id: string; active: boolean },
    { snapshot?: TMenuItem[] }
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
      const isGlobal = !locationIdForQuery;
      if (isGlobal) {
        if (!channelForQuery) {
          patchAllScopesSingle(id, active, 'all-channels');
        } else {
          patchAllScopesSingle(id, active, 'single-channel');
        }
      } else {
        if (!channelForQuery) {
          patchChannel('dine-in', (arr) => setRowState(arr ?? [], id, active));
          patchChannel('online', (arr) => setRowState(arr ?? [], id, active));
          queryClient.setQueryData<TMenuItem[]>(keyAll as any, (prev) => (prev ? setRowState(prev, id, active) : prev));
        } else {
          patchChannel(channelForQuery, (arr) => setRowState(arr ?? [], id, active));
          recomputeAllRowForLid(lidKey, id);
        }
        if (active === true) {
          queryClient.setQueryData<TMenuItem[]>(globalAllKey as any, (prev) =>
            prev ? setRowState(prev, id, true) : prev
          );
        } else {
          queryClient.invalidateQueries({ queryKey: globalAllKey as any });
        }
      }
      return {};
    },
    onError: (e) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token;
        },
      });
      if (e instanceof Error) toastError(e.message);
    },
    onSuccess: () => {
      broadcast();
    },
  });

  // Bulk toggle (availability only; never removes rows)
  const bulkAvailabilityMut = useMutation<
    BulkAvailRes,
    Error,
    { ids: string[]; active: boolean },
    { snapshot?: TMenuItem[] }
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
      const isGlobal = !locationIdForQuery;
      if (isGlobal) {
        if (!channelForQuery) {
          patchAllScopesBulk(ids, active, 'all-channels');
        } else {
          patchAllScopesBulk(ids, active, 'single-channel');
        }
      } else {
        if (!channelForQuery) {
          patchChannel('dine-in', (arr) => setBulkRowState(arr ?? [], ids, active));
          patchChannel('online', (arr) => setBulkRowState(arr ?? [], ids, active));
          queryClient.setQueryData<TMenuItem[]>(keyAll as any, (prev) =>
            prev ? setBulkRowState(prev, ids, active) : prev
          );
        } else {
          patchChannel(channelForQuery, (arr) => setBulkRowState(arr ?? [], ids, active));
          ids.forEach((id) => recomputeAllRowForLid(lidKey, id));
        }
        if (active === true) {
          queryClient.setQueryData<TMenuItem[]>(globalAllKey as any, (prev) =>
            prev ? setBulkRowState(prev, ids, true) : prev
          );
        } else {
          queryClient.invalidateQueries({ queryKey: globalAllKey as any });
        }
      }
      return {};
    },
    onError: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token;
        },
      });
    },
    onSuccess: (res, vars) => {
      // Show "Removed from this location" when doing branch-scope unavailable
      if (locationIdForQuery && vars.active === false) {
        toastSuccess(
          `Removed ${res.matchedCount} item${res.matchedCount === 1 ? '' : 's'} from this location.`
        );
      } else {
        const chan = channelForQuery
          ? channelForQuery === 'dine-in'
            ? ' • Dine-In'
            : ' • Online'
          : '';
        const loc = locationIdForQuery ? ' in this location' : ' across all locations';
        const action = vars.active ? 'Set available' : 'Set unavailable';
        toastSuccess(
          `${action}: ${res.modifiedCount}/${res.matchedCount} ${plural(res.matchedCount, 'item')}${chan}${loc}.`
        );
      }
      broadcast();
    },
    retry: shouldRetry,
    retryDelay,
  });

  // Delete (hard remove from lists) with scope-aware behavior
  const deleteMut = useMutation<void, Error, { id: string }, { snapshot?: TMenuItem[] }>({
    mutationFn: async ({ id }) => {
      // Call scoped delete endpoint; backend will interpret undefined to mean "not scoped"
      return minDelay(
        deleteMenuItem(id, token as string, {
          locationId: locationIdForQuery,
          channel: channelForQuery,
        } as any),
        MIN_MS
      );
    },
    onMutate: async ({ id }) => {
      start();
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      if (isGlobalView && !isChannelScoped) {
        // All locations + all channels → remove everywhere
        removeFromAllCachesEverywhere([id]);
      } else if (isGlobalView && isChannelScoped) {
        // All locations + single channel → remove only that channel across all lids
        removeFromChannelAcrossAllLids(channelForQuery!, [id]);
      } else if (!isGlobalView && isChannelScoped) {
        // Location + single channel → remove only in this location+channel
        patchChannel(channelForQuery!, (arr) => (arr ?? []).filter((it) => it.id !== id));
        // Recompute 'all' list for this lid: remove only if not present in the other channel list
        const otherChan = channelForQuery === 'dine-in' ? 'online' : 'dine-in';
        const otherListKey = otherChan === 'dine-in' ? keyDineIn : keyOnline;
        const otherHas = (queryClient.getQueryData<TMenuItem[]>(otherListKey as any) ?? []).some((x) => x.id === id);
        if (!otherHas) {
          queryClient.setQueryData<TMenuItem[]>(keyAll as any, filterOutId(id));
        }
        // Indicators
        const indKey = channelForQuery === 'dine-in' ? keyDIIndicator : keyONIndicator;
        queryClient.setQueryData<TMenuItem[]>(indKey as any, filterOutId(id));
      } else {
        // Location only (both channels) → remove from both channels + all for this lid
        patchChannel('dine-in', (arr) => (arr ?? []).filter((it) => it.id !== id));
        patchChannel('online', (arr) => (arr ?? []).filter((it) => it.id !== id));
        queryClient.setQueryData<TMenuItem[]>(keyAll as any, filterOutId(id));
      }

      return {};
    },
    onError: (e) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token;
        },
      });
      toastError((e as any)?.message || 'Failed to delete product');
    },
    onSuccess: () => {
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      // Tenant onboarding only for global hard delete
      if (isGlobalView && !isChannelScoped) {
        const remaining = queryClient.getQueryData<TMenuItem[]>(keyCurrent as any) ?? [];
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
        toastSuccess('Deleted item everywhere.');
      } else if (isGlobalView && isChannelScoped) {
        // Backend may hard-delete branch-scoped docs when last active channel is removed → re-sync all menus
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'menu-items' && q.queryKey[1] === token,
        });
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Deleted item from ${chanLabel} across all locations.`);
      } else if (!isGlobalView && isChannelScoped) {
        // IMPORTANT: if backend hard-deleted the branch-scoped item (last channel), we must refresh BOTH channels for this lid
        invalidateMenusForLid(lidKey as string);
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Deleted item from ${chanLabel} in this location.`);
      } else {
        toastSuccess('Deleted item from this location.');
      }

      broadcast();
    },
    onSettled: () => done(),
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
        ...(activeLocationId && session?.type !== 'central' ? { locationId: activeLocationId } : {}),
        ...(channelForQuery ? { channel: channelForQuery } : {}),
      };
      return createMenuItem(payload, token as string);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(keyCurrent as any, (prev) => [...(prev ?? []), created]);
      queryClient.setQueryData<TMenuItem[]>(globalAllKey as any, (prev) => {
        if (!prev) return prev;
        return prev.some((x) => x.id === created.id) ? prev : [...prev, created];
      });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token && k[2] === 'all';
        },
      });
      broadcast();
    },
  });

  const bulkDeleteMut = useMutation<
    BulkDeleteRes,
    Error,
    { ids: string[] },
    { snapshot?: TMenuItem[] }
  >({
    mutationFn: async ({ ids }) => {
      // Call scoped bulk delete endpoint
      return minDelay(
        bulkDeleteMenuItems(
          { ids, locationId: locationIdForQuery, channel: channelForQuery } as any,
          token as string
        ),
        MIN_MS
      );
    },
    onMutate: async ({ ids }) => {
      start();
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      if (isGlobalView && !isChannelScoped) {
        // All locations + all channels → remove everywhere
        removeFromAllCachesEverywhere(ids);
      } else if (isGlobalView && isChannelScoped) {
        // All locations + single channel → remove only that channel across all lids
        removeFromChannelAcrossAllLids(channelForQuery!, ids);
      } else if (!isGlobalView && isChannelScoped) {
        // Location + channel → remove only in this location+channel
        patchChannel(channelForQuery!, (arr) => (arr ?? []).filter((it) => !ids.includes(it.id)));
        const otherChan = channelForQuery === 'dine-in' ? 'online' : 'dine-in';
        const otherListKey = otherChan === 'dine-in' ? keyDineIn : keyOnline;
        const otherList = queryClient.getQueryData<TMenuItem[]>(otherListKey as any) ?? [];
        const keepInAll = new Set(otherList.map((x) => x.id));
        // Remove from 'all' only those not present in the other channel
        queryClient.setQueryData<TMenuItem[]>(
          keyAll as any,
          (prev) => (prev ?? []).filter((it) => keepInAll.has(it.id) || !ids.includes(it.id))
        );
        // Indicators
        const indKey = channelForQuery === 'dine-in' ? keyDIIndicator : keyONIndicator;
        queryClient.setQueryData<TMenuItem[]>(indKey as any, (prev) => (prev ?? []).filter((it) => !ids.includes(it.id)));
      } else {
        // Location only → remove from both channels + all for this lid
        patchChannel('dine-in', (arr) => (arr ?? []).filter((it) => !ids.includes(it.id)));
        patchChannel('online', (arr) => (arr ?? []).filter((it) => !ids.includes(it.id)));
        queryClient.setQueryData<TMenuItem[]>(keyAll as any, filterOutIds(ids));
      }

      return {};
    },
    onError: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token;
        },
      });
    },
    onSuccess: (_res, vars) => {
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      if (isGlobalView && !isChannelScoped) {
        const remaining = queryClient.getQueryData<TMenuItem[]>(keyCurrent as any) ?? [];
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
        toastSuccess(`Deleted ${plural(vars.ids.length, 'item')} everywhere.`);
        queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      } else if (isGlobalView && isChannelScoped) {
        // Some may be hard-deleted by backend (last active channel). Re-sync all menus.
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'menu-items' && q.queryKey[1] === token,
        });
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Deleted ${plural(vars.ids.length, 'item')} from ${chanLabel} across all locations.`);
      } else if (!isGlobalView && isChannelScoped) {
        // IMPORTANT: ensure both channel caches for this location reflect potential hard-deletes
        invalidateMenusForLid(lidKey as string);
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Deleted ${plural(vars.ids.length, 'item')} from ${chanLabel} in this location.`);
      } else {
        toastSuccess(`Deleted ${plural(vars.ids.length, 'item')} from this location.`);
      }

      broadcast();
    },
    onSettled: () => done(),
    retry: shouldRetry,
    retryDelay,
  });

  const bulkCategoryMut = useMutation<
    BulkCategoryRes,
    Error,
    { ids: string[]; category?: string; categoryId?: string },
    { snapshot?: TMenuItem[] }
  >({
    mutationFn: ({ ids, category, categoryId }) =>
      minDelay(bulkChangeCategoryApi(ids, category, categoryId, token as string), MIN_MS),
    onMutate: async () => {
      start();
      await queryClient.cancelQueries({ queryKey: keyCurrent });
      return {};
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: keyCurrent });
    },
    onSuccess: (res) => {
      const updatedById = new Map(res.items.map((u) => [u.id, u]));
      queryClient.setQueryData<TMenuItem[]>(keyCurrent as any, (arr) =>
        (arr ?? []).map((it) => updatedById.get(it.id) ?? it)
      );
      queryClient.setQueryData<TMenuItem[]>(keyAll as any, (arr) =>
        (arr ?? []).map((it) => updatedById.get(it.id) ?? it)
      );
      toastSuccess(`Updated category for ${plural(res.modifiedCount ?? res.items.length, 'item')}.`);
      broadcast();
    },
    onSettled: () => done(),
    retry: shouldRetry,
    retryDelay,
  });

  // Keep the original patch helpers (used by availability toggles)
  function patchAllScopesSingle(id: string, active: boolean, mode: 'all-channels' | 'single-channel') {
    const entries = queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] });
    const lids = new Set<string>();
    for (const [key, data] of entries) {
      const k = key as any[];
      const lid = k[2] as string;
      const chan = k[3] as string;
      const isIndicator = k[4] === 'indicator';
      lids.add(lid);

      if (!Array.isArray(data)) continue;

      if (mode === 'all-channels') {
        if (chan === 'dine-in' || chan === 'online' || isIndicator || chan === 'all') {
          queryClient.setQueryData<TMenuItem[]>(key as any, setRowState(data, id, active));
        }
      } else {
        if (chan === chanKey || (isIndicator && chanKey !== 'all')) {
          queryClient.setQueryData<TMenuItem[]>(key as any, setRowState(data, id, active));
        }
      }
    }
    if (mode === 'single-channel') {
      lids.forEach((lid) => recomputeAllRowForLid(lid, id));
    }
  }

  function patchAllScopesBulk(ids: string[], active: boolean, mode: 'all-channels' | 'single-channel') {
    const entries = queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] });
    const lids = new Set<string>();
    for (const [key, data] of entries) {
      const k = key as any[];
      const lid = k[2] as string;
      const chan = k[3] as string;
      const isIndicator = k[4] === 'indicator';
      lids.add(lid);

      if (!Array.isArray(data)) continue;

      if (mode === 'all-channels') {
        if (chan === 'dine-in' || chan === 'online' || isIndicator || chan === 'all') {
          queryClient.setQueryData<TMenuItem[]>(key as any, setBulkRowState(data, ids, active));
        }
      } else {
        if (chan === chanKey || (isIndicator && chanKey !== 'all')) {
          queryClient.setQueryData<TMenuItem[]>(key as any, setBulkRowState(data, ids, active));
        }
      }
    }
    if (mode === 'single-channel') {
      lids.forEach((lid) => {
        ids.forEach((id) => recomputeAllRowForLid(lid, id));
      });
    }
  }

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
