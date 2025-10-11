// apps/client-dashboard/src/components/categories/useCategories.ts
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  bulkSetCategoryVisibility,
  type Category,
  type Channel,
} from '../../api/categories';
import {
  getMenuItems,
  updateMenuItem,
  bulkUpdateAvailability,
  type MenuItem as TMenuItem,
} from '../../api/menuItems';
import { useAuthContext } from '../../context/AuthContext';
import { toastSuccess, toastError } from '../Toaster';
import type { TenantDTO } from '../../../../../packages/shared/src/types/v1';
import { useScope } from '../../context/ScopeContext';

function broadcast() {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('categories:updated'));
      window.dispatchEvent(new CustomEvent('menu:updated'));
      try {
        const BC: any = (window as any).BroadcastChannel;
        if (BC) {
          const c = new BC('categories');
          c.postMessage({ type: 'updated', at: Date.now() });
          c.close?.();
          const m = new BC('menu');
          m.postMessage({ type: 'updated', at: Date.now() });
          m.close?.();
        }
      } catch {}
    }
    localStorage.setItem('categories:updated', String(Date.now()));
    localStorage.setItem('menu:updated', String(Date.now()));
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
const plural = (n: number, s: string, p: string = s + 's') => `${n} ${n === 1 ? s : p}`;

export function useCategories() {
  const { token } = useAuthContext();
  const { activeLocationId, channel } = useScope();
  const queryClient = useQueryClient();
  const enabled = !!token;

  // Scope only from ScopeContext
  const locationIdForQuery = activeLocationId ?? undefined;
  const lidKey = locationIdForQuery || 'all';
  const channelForQuery = channel !== 'all' ? channel : undefined;
  const chanKey = channelForQuery || 'all';

  // Keys we touch often
  const catsKeyCurrent = ['categories', token, lidKey, chanKey] as const;
  const catsKeyAll = ['categories', token, lidKey, 'all'] as const;
  const catsKeyDineIn = ['categories', token, lidKey, 'dine-in'] as const;
  const catsKeyOnline = ['categories', token, lidKey, 'online'] as const;

  const itemsKeyCurrent = ['menu-items', token, lidKey, chanKey] as const;
  const itemsKeyAll = ['menu-items', token, lidKey, 'all'] as const;
  const diIndicatorKey = ['menu-items', token, lidKey, 'dine-in', 'indicator'] as const;
  const onIndicatorKey = ['menu-items', token, lidKey, 'online', 'indicator'] as const;
  const globalAllKey = ['menu-items', token, 'all', 'all'] as const; // All locations + All channels

  const categoriesQuery = useQuery<Category[]>({
    queryKey: catsKeyCurrent,
    queryFn: () =>
      getCategories(token as string, {
        locationId: locationIdForQuery,
        channel: channelForQuery,
      }),
    enabled,
    placeholderData: undefined,
    retry: shouldRetry,
    retryDelay,
  });

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: itemsKeyCurrent,
    queryFn: () =>
      getMenuItems(token as string, {
        locationId: locationIdForQuery,
        channel: channelForQuery,
      }),
    enabled,
    placeholderData: undefined,
    retry: shouldRetry,
    retryDelay,
  });

  const categories = categoriesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const usageMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const key = (it.category || '').trim();
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const findById = (id: string) => categories.find((c) => c.id === id) || null;
  const findByName = (name: string) =>
    categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;

  // Helpers for item patching (used by availabilityMut)
  const patchByCategory =
    (name: string, active: boolean) =>
    (arr: TMenuItem[] | undefined): TMenuItem[] =>
      (arr ?? []).map((it) =>
        it.category === name
          ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
          : it
      );

  // Recompute a lid's 'all' list rows for a set of ids by reading its DI/ON caches
  function recomputeAllRowsForLidByIds(lid: string, ids: string[]) {
    const kDI = ['menu-items', token, lid, 'dine-in'] as const;
    const kON = ['menu-items', token, lid, 'online'] as const;
    const kALL = ['menu-items', token, lid, 'all'] as const;
    const di = queryClient.getQueryData<TMenuItem[]>(kDI as any) ?? [];
    const on = queryClient.getQueryData<TMenuItem[]>(kON as any) ?? [];
    const diMap = new Map(di.map((x) => [x.id, !(x.hidden || x.status === 'hidden')]));
    const onMap = new Map(on.map((x) => [x.id, !(x.hidden || x.status === 'hidden')]));
    queryClient.setQueryData<TMenuItem[]>(kALL as any, (prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      for (let i = 0; i < next.length; i++) {
        const it = next[i] as any;
        if (!ids.includes(it.id)) continue;
        const d = diMap.get(it.id);
        const o = onMap.get(it.id);
        const active = d === true || o === true ? true : d === false && o === false ? false : undefined;
        if (active !== undefined) {
          next[i] = { ...it, hidden: !active, status: active ? 'active' : 'hidden' };
        }
      }
      return next;
    });
  }

  // 🔧 Helper: if a category id is not present in ANY location/channel cache, purge it from All-Locations caches too.
  function purgeFromAllLocationsIfAbsentEverywhere(catId: string) {
    const entries = queryClient.getQueriesData<Category[]>({ queryKey: ['categories', token] });

    // Is the category present in any per-location cache?
    let existsSomewhere = false;
    for (const [key, data] of entries) {
      const k = key as any[];
      if (!Array.isArray(k) || k[0] !== 'categories' || k[1] !== token) continue;
      const lid = k[2];
      if (lid === 'all') continue; // skip All-Locations during presence check
      if (Array.isArray(data) && data.some((c) => c.id === catId)) {
        existsSomewhere = true;
        break;
      }
    }
    if (existsSomewhere) return;

    // Remove from every All-Locations cache (all/dine-in/online)
    queryClient.getQueriesData<Category[]>({ queryKey: ['categories', token, 'all'] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      queryClient.setQueryData<Category[]>(
        key as any,
        (prev) => (prev ?? []).filter((c) => c.id !== catId)
      );
    });
  }

  // Cross-scope patchers (mirror useMenuItems) — used only for item availability-by-category
  function patchAllScopesByCategory(
    name: string,
    active: boolean,
    mode: 'all-channels' | 'single-channel'
  ) {
    const entries = queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] });
    const lidsChanged = new Map<string, Set<string>>(); // lid -> ids changed

    for (const [key, data] of entries) {
      const k = key as any[];
      const lid = k[2] as string;
      const chan = k[3] as string;
      const isIndicator = k[4] === 'indicator';
      if (!Array.isArray(data)) continue;

      const affectedIds = data.filter((x) => (x as any).category === name).map((x) => x.id);
      if (affectedIds.length) {
        if (!lidsChanged.has(lid)) lidsChanged.set(lid, new Set());
        affectedIds.forEach((id) => lidsChanged.get(lid)!.add(id));
      }

      if (mode === 'all-channels') {
        if (chan === 'dine-in' || chan === 'online' || chan === 'all' || isIndicator) {
          queryClient.setQueryData<TMenuItem[]>(key as any, patchByCategory(name, active)(data));
        }
      } else {
        if (chan === chanKey || (isIndicator && chanKey !== 'all')) {
          queryClient.setQueryData<TMenuItem[]>(key as any, patchByCategory(name, active)(data));
        }
      }
    }

    if (mode === 'single-channel') {
      lidsChanged.forEach((ids, lid) => recomputeAllRowsForLidByIds(lid, Array.from(ids)));
    }
  }

  // Create category (supports Advanced: channel + include/exclude lists)
  type CreateOpts = {
    locationId?: string;
    channel?: Channel | 'both'; // allow 'both' in UI, we normalize before calling API
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
  };
  type CreateVars = string | { name: string; opts?: CreateOpts };

  const createMut = useMutation<Category, Error, CreateVars>({
    mutationFn: async (vars) => {
      const name = typeof vars === 'string' ? vars : vars.name;
      const formOpts = typeof vars === 'string' ? undefined : vars.opts;

      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required.');
      if (findByName(trimmed)) throw new Error('A category with this name already exists.');

      // Normalize channel: 'both' => omit (server treats omitted as BOTH)
      const rawChannel = formOpts?.channel ?? channelForQuery;
      const normalizedChannel = rawChannel === 'both' ? undefined : rawChannel;

      const chosenLocationId = formOpts?.locationId ?? locationIdForQuery;

      return createCategory(trimmed, token as string, {
        locationId: chosenLocationId || undefined,
        channel: normalizedChannel || undefined, // only 'dine-in' | 'online'; omit for BOTH
        includeLocationIds: formOpts?.includeLocationIds,
        excludeLocationIds: formOpts?.excludeLocationIds,
      });
    },
    onSuccess: (_created) => {
      // Don’t optimistically insert: overlays/channelScope might hide it in current view.
      // Instead, refetch all category caches for this tenant to get authoritative visibility.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });

      // Onboarding: mark that tenant now has a category
      queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
        prev
          ? {
              ...prev,
              onboardingProgress: {
                hasCategory: true,
                hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                checklist: prev.onboardingProgress?.checklist,
              },
            }
          : prev
      );
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Category added');
      broadcast();
    },
    onError: (e: any) => {
      toastError(e?.message || 'Failed to add category');
    },
  });

  // ----- FIXED: location-scoped channel changes should use overlay + force refetch of branch caches -----
  type RenameOpts = {
    channel?: Channel | 'both';
    includeLocationIds?: string[];
    excludeLocationIds?: string[];
    hardExclude?: boolean;
  };

  const renameMut = useMutation({
    mutationFn: async ({
      id,
      newName,
      opts,
    }: {
      id: string;
      newName: string;
      opts?: RenameOpts;
    }) => {
      const current = findById(id);
      if (!current) throw new Error('Category not found.');
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name is required.');

      const isBranchScoped = !!locationIdForQuery;

      // Don’t let channel propagate globally when in a branch; apply via overlays instead.
      const desiredChannel = isBranchScoped ? opts?.channel : undefined;
      const { channel: _omit, ...optsWithoutChannel } = opts ?? {};

      // If name unchanged, still push advanced opts (minus channel for branch scope)
      if (trimmed.toLowerCase() === current.name.toLowerCase()) {
        const res = await updateCategory(
          id,
          current.name,
          token as string,
          isBranchScoped ? (optsWithoutChannel as RenameOpts) : opts
        );

        // Apply overlays for this branch if user changed channels
        if (isBranchScoped && desiredChannel) {
          const ids = [id];
          if (desiredChannel === 'both') {
            await Promise.allSettled([
              bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'dine-in'),
              bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'online'),
            ]);
          } else if (desiredChannel === 'dine-in') {
            await Promise.allSettled([
              bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'dine-in'),
              bulkSetCategoryVisibility(ids, false, token as string, locationIdForQuery, 'online'),
            ]);
          } else if (desiredChannel === 'online') {
            await Promise.allSettled([
              bulkSetCategoryVisibility(ids, false, token as string, locationIdForQuery, 'dine-in'),
              bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'online'),
            ]);
          }
        }

        return res;
      }

      // Name changed → keep uniqueness within current list
      if (findByName(trimmed)) throw new Error('A category with this name already exists.');

      const updated = await updateCategory(
        id,
        trimmed,
        token as string,
        isBranchScoped ? (optsWithoutChannel as RenameOpts) : opts
      );

      // Optimistic item rename within the current scope
      const oldName = current.name;
      queryClient.setQueryData<TMenuItem[]>(
        itemsKeyCurrent as any,
        (prev) =>
          (prev ?? []).map((it) =>
            it.category === oldName ? ({ ...it, category: updated.name } as TMenuItem) : it
          )
      );

      // Persist item renames for items currently in scope
      const list =
        queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ??
        (await getMenuItems(token as string, {
          locationId: locationIdForQuery,
          channel: channelForQuery,
        }));
      await Promise.allSettled(
        list
          .filter((it) => it.category === oldName)
          .map((it) => updateMenuItem(it.id, { category: updated.name }, token as string))
      );

      // Apply overlays (branch scope channel change)
      if (isBranchScoped && desiredChannel) {
        const ids = [id];
        if (desiredChannel === 'both') {
          await Promise.allSettled([
            bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'dine-in'),
            bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'online'),
          ]);
        } else if (desiredChannel === 'dine-in') {
          await Promise.allSettled([
            bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'dine-in'),
            bulkSetCategoryVisibility(ids, false, token as string, locationIdForQuery, 'online'),
          ]);
        } else if (desiredChannel === 'online') {
          await Promise.allSettled([
            bulkSetCategoryVisibility(ids, false, token as string, locationIdForQuery, 'dine-in'),
            bulkSetCategoryVisibility(ids, true, token as string, locationIdForQuery, 'online'),
          ]);
        }
      }

      return updated;
    },
    onSuccess: async (_updated, vars) => {
      // Force-refresh the exact caches that reflect per-branch/per-channel visibility
      queryClient.invalidateQueries({ queryKey: catsKeyCurrent as any });
      queryClient.invalidateQueries({ queryKey: catsKeyAll as any });
      queryClient.invalidateQueries({ queryKey: catsKeyDineIn as any });
      queryClient.invalidateQueries({ queryKey: catsKeyOnline as any });

      // Also kick all categories caches for this tenant (safe catch-all)
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });

      // Small optimistic UX: if we’re in a branch scope and user selected a single channel,
      // remove the row immediately when the current view is the *other* channel.
      const desiredChannel = (vars as any)?.opts?.channel as Channel | 'both' | undefined;
      if (locationIdForQuery && desiredChannel && desiredChannel !== 'both') {
        if (desiredChannel === 'dine-in' && chanKey === 'online') {
          queryClient.setQueryData<Category[]>(
            catsKeyCurrent as any,
            (prev) => (prev ?? []).filter((c) => c.id !== (vars as any).id)
          );
        } else if (desiredChannel === 'online' && chanKey === 'dine-in') {
          queryClient.setQueryData<Category[]>(
            catsKeyCurrent as any,
            (prev) => (prev ?? []).filter((c) => c.id !== (vars as any).id)
          );
        }
      }

      toastSuccess('Category updated');
      broadcast();
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: itemsKeyCurrent as any });
      toastError((e as any)?.message || 'Failed to rename category');
    },
  });
  // -----------------------------------------------------------------------------------------

  // Helpers for scoped category deletions (optimistic cache updates)
  const filterOutCatId =
    (id: string) =>
    (prev: Category[] | undefined): Category[] | undefined =>
      prev ? prev.filter((c) => c.id !== id) : prev;

  function removeCategoryEverywhere(id: string) {
    queryClient.getQueriesData<Category[]>({ queryKey: ['categories', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      queryClient.setQueryData<Category[]>(key as any, filterOutCatId(id));
    });
  }

  function removeCategoryFromChannelAcrossAllLids(chan: 'dine-in' | 'online', id: string) {
    queryClient.getQueriesData<Category[]>({ queryKey: ['categories', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      const k = key as any[];
           const cacheChan = k[3] as string;
      if (cacheChan === chan) {
        queryClient.setQueryData<Category[]>(key as any, filterOutCatId(id));
      }
    });
    // Do not touch 'all' lists; the category may still exist in the other channel.
  }

  // ---------- NEW: item removal helpers to mirror backend cascades ----------
  const filterOutItemsByCategory =
    (name: string) =>
    (prev: TMenuItem[] | undefined): TMenuItem[] | undefined =>
      prev ? prev.filter((it) => it.category !== name) : prev;

  function removeItemsEverywhereByCategory(name: string) {
    queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      queryClient.setQueryData<TMenuItem[]>(key as any, filterOutItemsByCategory(name));
    });
  }

  function removeItemsByCategoryFromChannelAcrossAllLids(
    chan: 'dine-in' | 'online',
    name: string
  ) {
    const perLidRemovedIds = new Map<string, Set<string>>();

    queryClient.getQueriesData<TMenuItem[]>({ queryKey: ['menu-items', token] }).forEach(([key, data]) => {
      if (!Array.isArray(data)) return;
      const k = key as any[];
      const lid = k[2] as string;
      const cacheChan = k[3] as string;
      const isIndicator = k[4] === 'indicator';

      if (cacheChan === chan || isIndicator) {
        const removed = new Set<string>();
        data.forEach((it) => {
          if (it.category === name) removed.add(it.id);
        });
        if (removed.size) {
          if (!perLidRemovedIds.has(lid)) perLidRemovedIds.set(lid, new Set());
          removed.forEach((id) => perLidRemovedIds.get(lid)!.add(id));
        }
        queryClient.setQueryData<TMenuItem[]>(key as any, filterOutItemsByCategory(name));
      }
    });

    // For each lid, update 'all' only when the item no longer exists in the OTHER channel list
    perLidRemovedIds.forEach((ids, lid) => {
      const otherChan = chan === 'dine-in' ? 'online' : 'dine-in';
      const otherKey = ['menu-items', token, lid, otherChan] as const;
      const otherList = queryClient.getQueryData<TMenuItem[]>(otherKey as any) ?? [];
      const keepIds = new Set(otherList.map((x) => x.id));
      const allKey = ['menu-items', token, lid, 'all'] as const;
      queryClient.setQueryData<TMenuItem[]>(
        allKey as any,
        (prev) =>
          (prev ?? []).filter((it) => it.category !== name || keepIds.has(it.id))
      );
    });
  }

  function removeItemsByCategoryInCurrentLidChannel(name: string) {
    // Only in this location + channel
    if (!channelForQuery) return;
    queryClient.setQueryData<TMenuItem[]>(itemsKeyCurrent as any, filterOutItemsByCategory(name));
    const otherChan = channelForQuery === 'dine-in' ? 'online' : 'dine-in';
    const otherKey = ['menu-items', token, lidKey, otherChan] as const;
    const otherList = queryClient.getQueryData<TMenuItem[]>(otherKey as any) ?? [];
    const keepIds = new Set(otherList.map((x) => x.id));
    queryClient.setQueryData<TMenuItem[]>(
      itemsKeyAll as any,
      (prev) =>
        (prev ?? []).filter((it) => it.category !== name || keepIds.has(it.id))
    );
    // indicators
    const indKey = channelForQuery === 'dine-in' ? diIndicatorKey : onIndicatorKey;
    queryClient.setQueryData<TMenuItem[]>(indKey as any, filterOutItemsByCategory(name));
  }

  function removeItemsByCategoryInCurrentLidBothChannels(name: string) {
    // Location only (both channels)
    queryClient.setQueryData<TMenuItem[]>(
      ['menu-items', token, lidKey, 'dine-in'] as any,
      filterOutItemsByCategory(name)
    );
    queryClient.setQueryData<TMenuItem[]>(
      ['menu-items', token, lidKey, 'online'] as any,
      filterOutItemsByCategory(name)
    );
    queryClient.setQueryData<TMenuItem[]>(itemsKeyAll as any, filterOutItemsByCategory(name));
    queryClient.setQueryData<TMenuItem[]>(diIndicatorKey as any, filterOutItemsByCategory(name));
    queryClient.setQueryData<TMenuItem[]>(onIndicatorKey as any, filterOutItemsByCategory(name));
  }
  // -------------------------------------------------------------------------

  const deleteMut = useMutation({
    mutationFn: async ({
      id,
      mode,
      reassignToId,
    }: {
      id: string;
      mode: 'cascade' | 'reassign';
      reassignToId?: string;
    }) => {
      const target = findById(id);
      if (!target) throw new Error('Category not found.');

      if (mode === 'reassign') {
        const to = reassignToId ? findById(reassignToId) : null;
        if (!to) throw new Error('Select a category to reassign to.');
        const oldName = target.name;
        const newName = to.name;

        const snapshot =
          queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ?? [];
        // Optimistic items in current scope
        queryClient.setQueryData<TMenuItem[]>(
          itemsKeyCurrent as any,
          (prev) =>
            (prev ?? []).map((it) =>
              it.category === oldName ? ({ ...it, category: newName } as TMenuItem) : it
            )
        );

        const itemsList =
          snapshot.length
            ? snapshot
            : await getMenuItems(token as string, { locationId: locationIdForQuery, channel: channelForQuery });

        await Promise.allSettled(
          itemsList
            .filter((it) => it.category === oldName)
            .map((it) => updateMenuItem(it.id, { category: newName }, token as string))
        );
      }

      // Scoped delete (backend interprets undefined as "not scoped")
      await deleteCategory(id, token as string, {
        locationId: locationIdForQuery,
        channel: channelForQuery,
      } as any);
      return { id, deletedName: target.name };
    },
    onMutate: async ({ id }) => {
      // Optimistically remove CATEGORY from the relevant caches based on scope
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      if (isGlobalView && !isChannelScoped) {
        // All locations + all channels → remove everywhere
        removeCategoryEverywhere(id);
      } else if (isGlobalView && isChannelScoped) {
        // All locations + single channel → remove only that channel across all lids
        removeCategoryFromChannelAcrossAllLids(channelForQuery!, id);
      } else if (!isGlobalView && isChannelScoped) {
        // Location + single channel → remove only in this location+channel
        queryClient.setQueryData<Category[]>(catsKeyCurrent as any, (prev) =>
          (prev ?? []).filter((c) => c.id !== id)
        );

        // Drop from this location's "all" cache only if absent in other channel
        const otherChan = channelForQuery === 'dine-in' ? 'online' : 'dine-in';
        const otherKey = otherChan === 'dine-in' ? catsKeyDineIn : catsKeyOnline;
        const otherList = queryClient.getQueryData<Category[]>(otherKey as any) ?? [];
        const stillInOther = otherList.some((c) => c.id === id);
        if (!stillInOther) {
          queryClient.setQueryData<Category[]>(catsKeyAll as any, (prev) =>
            (prev ?? []).filter((c) => c.id !== id)
          );
        }
      } else {
        // Location only → remove from both channels + 'all' for this lid
        queryClient.setQueryData<Category[]>(catsKeyDineIn as any, (prev) =>
          (prev ?? []).filter((c) => c.id !== id)
        );
        queryClient.setQueryData<Category[]>(catsKeyOnline as any, (prev) =>
          (prev ?? []).filter((c) => c.id !== id)
        );
        queryClient.setQueryData<Category[]>(catsKeyAll as any, (prev) =>
          (prev ?? []).filter((c) => c.id !== id)
        );
      }

      return {};
    },
    onSuccess: ({ id, deletedName }) => {
      // -------- Optimistically remove ITEMS by category to mirror backend cascades --------
      const isGlobalView = !locationIdForQuery;
      const isChannelScoped = !!channelForQuery;

      if (isGlobalView && !isChannelScoped) {
        removeItemsEverywhereByCategory(deletedName);
      } else if (isGlobalView && isChannelScoped) {
        removeItemsByCategoryFromChannelAcrossAllLids(channelForQuery!, deletedName);
      } else if (!isGlobalView && isChannelScoped) {
        removeItemsByCategoryInCurrentLidChannel(deletedName);
      } else {
        removeItemsByCategoryInCurrentLidBothChannels(deletedName);
      }
      // ---------------------------------------------------------------------

      // Keep previous behavior for onboarding based on current scope list emptiness
      const next = queryClient.setQueryData<Category[]>(
        catsKeyCurrent as any,
        (prev) => (prev ?? []).filter((c) => c.id !== id)
      ) as Category[] | undefined;

      // 🔁 NEW: Recompute tenant "hasCategory" globally (across ALL lids/channels),
      // so the checklist reflects deletes done from a branch scope as well.
      // We look through every categories cache for this token; if none have any rows,
      // we flip hasCategory to false. Otherwise keep it true.
      const allCatCaches = queryClient.getQueriesData<Category[]>({ queryKey: ['categories', token] });
      let anyCategoryLeftAnywhere = false;
      for (const [_key, data] of allCatCaches) {
        if (Array.isArray(data) && data.length > 0) {
          anyCategoryLeftAnywhere = true;
          break;
        }
      }

      queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
        prev
          ? {
              ...prev,
              onboardingProgress: {
                hasCategory: anyCategoryLeftAnywhere, // ✅ reflects global state
                hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                checklist: prev.onboardingProgress?.checklist,
              },
            }
          : prev
      );

      // Optional: nudge the "All locations" caches if this id vanished everywhere
      // (keeps the All-locations tabs perfectly in sync without a hard refetch)
      purgeFromAllLocationsIfAbsentEverywhere(id);

      // Refresh items/tenant in current scope
      queryClient.invalidateQueries({ queryKey: itemsKeyCurrent as any });
      queryClient.invalidateQueries({ queryKey: diIndicatorKey as any });
      queryClient.invalidateQueries({ queryKey: onIndicatorKey as any });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      // 🔁 Invalidate ALL category caches (any lid/channel) after server-side delete/tombstone
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });

      // Toast by scope
      if (isGlobalView && !isChannelScoped) {
        toastSuccess('Category deleted everywhere.');
      } else if (isGlobalView && isChannelScoped) {
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Category deleted from ${chanLabel} across all locations.`);
      } else if (!isGlobalView && isChannelScoped) {
        const chanLabel = channelForQuery === 'dine-in' ? 'Dine-In' : 'Online';
        toastSuccess(`Category deleted from ${chanLabel} in this location.`);
      } else {
        toastSuccess('Category deleted from this location.');
      }

      broadcast();
    },
    onError: (e: any) => {
      // Re-sync all category queries for this token
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });
      toastError(e?.message || 'Failed to delete category');
    },
  });

  // Category visibility per-branch/per-channel (overlay)
  const bulkVisibilityMut = useMutation<
    { visible: boolean; matchedCount: number; modifiedCount: number },
    Error,
    { ids: string[]; visible: boolean; locationId?: string; channel?: Channel }
  >({
    mutationFn: async ({ ids, visible, locationId, channel }) => {
      const res = await bulkSetCategoryVisibility(
        ids,
        visible,
        token as string,
        locationId ?? locationIdForQuery ?? undefined,
        channel ?? channelForQuery ?? undefined
      );
      return { visible, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount };
    },
    onMutate: async ({ ids, visible }) => {
      if (visible === false) {
        queryClient.setQueryData<Category[]>(
          catsKeyCurrent as any,
          (prev) => (prev ?? []).filter((c) => !ids.includes(c.id))
        );
      }
      return {};
    },
    onError: (e) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });
      if (e instanceof Error) toastError(e.message);
    },
    onSuccess: ({ visible, matchedCount, modifiedCount }) => {
      // Refresh categories (visibility affects lists)
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token;
        },
      });
      const chan = channelForQuery ? (channelForQuery === 'dine-in' ? ' • Dine-In' : ' • Online') : '';
      const loc = locationIdForQuery ? ' in this location' : ' across all locations';
      const verb = visible ? 'Shown' : 'Hidden';
      toastSuccess(`${verb}: ${modifiedCount}/${matchedCount} ${plural(matchedCount, 'category')}${chan}${loc}.`);
      broadcast();
    },
  });

  // Toggle availability for all items in a category (branch/channel-aware)
  const availabilityMut = useMutation<
    { name: string; active: boolean; matchedCount: number; modifiedCount: number },
    Error,
    { name: string; active: boolean },
    { snapshot?: TMenuItem[] }
  >({
    mutationFn: async ({ name, active }) => {
      const list =
        queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ??
        (await getMenuItems(token as string, { locationId: locationIdForQuery, channel: channelForQuery }));

      const targetIds = list.filter((it) => it.category === name).map((it) => it.id);
      if (targetIds.length === 0) return { name, active, matchedCount: 0, modifiedCount: 0 };

      const res = await bulkUpdateAvailability(
        targetIds,
        active,
        token as string,
        locationIdForQuery || undefined,
        channelForQuery || undefined
      );
      return { name, active, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount };
    },
    onMutate: async ({ name, active }) => {
      await queryClient.cancelQueries({ queryKey: itemsKeyCurrent as any });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ?? [];

      const isGlobal = !locationIdForQuery;

      if (isGlobal) {
        if (!channelForQuery) {
          patchAllScopesByCategory(name, active, 'all-channels');
        } else {
          patchAllScopesByCategory(name, active, 'single-channel');
        }
      } else {
        if (!channelForQuery) {
          queryClient.setQueryData<TMenuItem[]>(
            ['menu-items', token, lidKey, 'dine-in'] as any,
            patchByCategory(name, active)
          );
          queryClient.setQueryData<TMenuItem[]>(
            ['menu-items', token, lidKey, 'online'] as any,
            patchByCategory(name, active)
          );
          queryClient.setQueryData<TMenuItem[]>(itemsKeyAll as any, patchByCategory(name, active));
          queryClient.setQueryData<TMenuItem[]>(
            diIndicatorKey as any,
            (prev) => (prev ? patchByCategory(name, active)(prev) : prev)
          );
          queryClient.setQueryData<TMenuItem[]>(
            onIndicatorKey as any,
            (prev) => (prev ? patchByCategory(name, active)(prev) : prev)
          );
        } else {
          queryClient.setQueryData<TMenuItem[]>(itemsKeyCurrent as any, patchByCategory(name, active));
          const arr = queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ?? [];
          const ids = arr.filter((x) => x.category === name).map((x) => x.id);
          if (ids.length) recomputeAllRowsForLidByIds(lidKey, ids);
        }

        if (active === true) {
          queryClient.setQueryData<TMenuItem[]>(
            globalAllKey as any,
            (prev) => (prev ? patchByCategory(name, true)(prev) : prev)
          );
        } else {
          queryClient.invalidateQueries({ queryKey: globalAllKey as any });
        }
      }

      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(itemsKeyCurrent as any, ctx.snapshot);
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items' && k[1] === token;
        },
      });
      if (e instanceof Error) toastError(e.message);
    },
    onSuccess: ({ active, matchedCount, modifiedCount }) => {
      const chan = channelForQuery ? (channelForQuery === 'dine-in' ? ' • Dine-In' : ' • Online') : '';
      const loc = locationIdForQuery ? ' in this location' : ' across all locations';
      const action = active ? 'Set available' : 'Set unavailable';
      toastSuccess(`${action}: ${modifiedCount}/${matchedCount} ${plural(matchedCount, 'item')}${chan}${loc}.`);
      broadcast();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKeyCurrent as any });
      queryClient.invalidateQueries({ queryKey: diIndicatorKey as any });
      queryClient.invalidateQueries({ queryKey: onIndicatorKey as any });
    },
  });

  // Merge categories (branch/channel-aware by operating on currently scoped items)
  const mergeMut = useMutation({
    mutationFn: async ({ fromIds, toId }: { fromIds: string[]; toId: string }) => {
      const to = findById(toId);
      if (!to) throw new Error('Target category not found.');
      const from = fromIds.map(findById).filter(Boolean) as Category[];
      if (!from.length) throw new Error('No categories to merge.');
      if (from.some((f) => f.id === toId)) throw new Error('Cannot merge a category into itself.');

      const fromNames = from.map((f) => f.name);
      const toName = to.name;

      const snapshot = queryClient.getQueryData<TMenuItem[]>(itemsKeyCurrent as any) ?? [];
      // Optimistic within current scope
      queryClient.setQueryData<TMenuItem[]>(
        itemsKeyCurrent as any,
        (prev) =>
          (prev ?? []).map((it) =>
            it.category && fromNames.includes(it.category)
              ? ({ ...it, category: toName } as TMenuItem)
              : it
          )
      );

      const itemsList =
        snapshot.length
          ? snapshot
          : await getMenuItems(token as string, {
              locationId: locationIdForQuery,
              channel: channelForQuery,
            });

      await Promise.allSettled(
        itemsList
          .filter((it) => it.category && fromNames.includes(it.category))
          .map((it) => updateMenuItem(it.id, { category: toName }, token as string))
      );

      await Promise.allSettled(from.map((f) => deleteCategory(f.id, token as string)));

      return { removedIds: from.map((f) => f.id) };
    },
    onSuccess: ({ removedIds }) => {
      queryClient.setQueryData<Category[]>(
        catsKeyCurrent as any,
        (prev) => (prev ?? []).filter((c) => !removedIds.includes(c.id))
      );

      queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
        prev
          ? {
              ...prev,
              onboardingProgress: {
                hasCategory: true,
                hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                checklist: prev.onboardingProgress?.checklist,
              },
            }
          : prev
      );

      queryClient.invalidateQueries({ queryKey: itemsKeyCurrent as any });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      // Ensure All-locations category queries refetch
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'categories' && k[1] === token && k[2] === 'all';
        },
      });

      toastSuccess('Categories merged');
      broadcast();
    },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: itemsKeyCurrent as any });
      queryClient.invalidateQueries({ queryKey: catsKeyCurrent as any });
      toastError(e?.message || 'Failed to merge categories');
    },
  });

  return {
    categoriesQuery,
    itemsQuery,
    categories,
    items,
    usageMap,
    createMut,
    renameMut,
    deleteMut,
    mergeMut,
    availabilityMut, // items availability by category (optional control)
    bulkVisibilityMut, // show/hide categories per branch/channel with feedback
  };
}
