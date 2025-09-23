// components/categories/useCategories.ts
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type Category,
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
    localStorage.setItem('categories:updated', String(Date.now()));
    localStorage.setItem('menu:updated', String(Date.now()));
  } catch {}
}

export function useCategories() {
  const { token, session } = useAuthContext();
  const { activeLocationId } = useScope();
  const queryClient = useQueryClient();
  const enabled = !!token;

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token, activeLocationId || 'all'],
    queryFn: () => getCategories(token as string, { locationId: activeLocationId || undefined }),
    enabled,
  });

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token, activeLocationId || 'all'],
    queryFn: () => getMenuItems(token as string, { locationId: activeLocationId || undefined }),
    enabled,
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

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required.');
      if (findByName(trimmed)) throw new Error('A category with this name already exists.');

      // If a specific branch is selected (owner/admin), create as branch-only
      return createCategory(trimmed, token as string, {
        locationId: activeLocationId || undefined,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Category[]>(
        ['categories', token, activeLocationId || 'all'],
        (prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name))
      );

      // Ensure onboarding flags are consistent
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

  const renameMut = useMutation({
    mutationFn: async ({ id, newName }: { id: string; newName: string }) => {
      const current = findById(id);
      if (!current) throw new Error('Category not found.');
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name is required.');
      if (trimmed.toLowerCase() === current.name.toLowerCase()) return current;
      if (findByName(trimmed)) throw new Error('A category with this name already exists.');

      const updated = await updateCategory(id, trimmed, token as string);

      const oldName = current.name;
      // Optimistically update items in cache for the current view scope
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, activeLocationId || 'all'],
        (prev) =>
          (prev ?? []).map((it) =>
            it.category === oldName ? ({ ...it, category: updated.name } as TMenuItem) : it
          )
      );

      // Persist rename on the server for items currently visible in scope
      const list =
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ??
        (await getMenuItems(token as string, { locationId: activeLocationId || undefined }));
      await Promise.allSettled(
        list
          .filter((it) => it.category === oldName)
          .map((it) => updateMenuItem(it.id, { category: updated.name }, token as string))
      );

      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Category[]>(
        ['categories', token, activeLocationId || 'all'],
        (prev) =>
          (prev ?? [])
            .map((c) => (c.id === updated.id ? updated : c))
            .sort((a, b) => a.name.localeCompare(b.name))
      );
      toastSuccess('Category renamed');
      broadcast();
    },
    onError: (e) => {
      // Make sure the list is refreshed if rename propagation failed
      queryClient.invalidateQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      toastError((e as any)?.message || 'Failed to rename category');
    },
  });

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
          queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
        // Optimistic in current scope
        queryClient.setQueryData<TMenuItem[]>(
          ['menu-items', token, activeLocationId || 'all'],
          (prev) =>
            (prev ?? []).map((it) =>
              it.category === oldName ? ({ ...it, category: newName } as TMenuItem) : it
            )
        );

        const itemsList =
          snapshot.length
            ? snapshot
            : await getMenuItems(token as string, { locationId: activeLocationId || undefined });

        await Promise.allSettled(
          itemsList
            .filter((it) => it.category === oldName)
            .map((it) => updateMenuItem(it.id, { category: newName }, token as string))
        );
      }

      await deleteCategory(id, token as string);
      return { id };
    },
    onSuccess: ({ id }) => {
      const next = queryClient.setQueryData<Category[]>(
        ['categories', token, activeLocationId || 'all'],
        (prev) => (prev ?? []).filter((c) => c.id !== id)
      ) as Category[] | undefined;

      const noneLeft = !next || next.length === 0;
      if (noneLeft) {
        queryClient.setQueryData<TenantDTO>(['tenant', token], (prev) =>
          prev
            ? {
                ...prev,
                onboardingProgress: {
                  hasCategory: false,
                  hasMenuItem: prev.onboardingProgress?.hasMenuItem ?? false,
                  checklist: prev.onboardingProgress?.checklist,
                },
              }
            : prev
        );
      }

      queryClient.invalidateQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Category deleted');
      broadcast();
    },
    onError: (e: any) => {
      toastError(e?.message || 'Failed to delete category');
    },
  });

  // Category availability per-branch: toggle all items in this category in the current scope
  const availabilityMut = useMutation<
    { name: string; active: boolean },
    Error,
    { name: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ name, active }) => {
      if (!activeLocationId && session?.type !== 'central') {
        throw new Error('Select a location to toggle category visibility');
      }
      const list =
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ??
        (await getMenuItems(token as string, { locationId: activeLocationId || undefined }));

      const targetIds = list.filter((it) => it.category === name).map((it) => it.id);
      if (targetIds.length === 0) return { name, active };

      // Use per-branch bulk availability overlay
      await bulkUpdateAvailability(targetIds, active, token as string, activeLocationId || undefined);
      return { name, active };
    },
    onMutate: async ({ name, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      // Optimistic update in current scope
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, activeLocationId || 'all'],
        (prev) =>
          (prev ?? []).map((it) =>
            it.category === name
              ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
              : it
          )
      );
      return { snapshot };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token, activeLocationId || 'all'], ctx.snapshot);
      if (e instanceof Error) toastError(e.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      broadcast();
    },
  });

  // Merge categories (kept; branch-aware by operating on currently scoped items)
  const mergeMut = useMutation({
    mutationFn: async ({ fromIds, toId }: { fromIds: string[]; toId: string }) => {
      const to = findById(toId);
      if (!to) throw new Error('Target category not found.');
      const from = fromIds.map(findById).filter(Boolean) as Category[];
      if (!from.length) throw new Error('No categories to merge.');
      if (from.some((f) => f.id === toId)) throw new Error('Cannot merge a category into itself.');

      const fromNames = from.map((f) => f.name);
      const toName = to.name;

      const snapshot =
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token, activeLocationId || 'all']) ?? [];
      // Optimistic within current scope
      queryClient.setQueryData<TMenuItem[]>(
        ['menu-items', token, activeLocationId || 'all'],
        (prev) =>
          (prev ?? []).map((it) =>
            it.category && fromNames.includes(it.category) ? ({ ...it, category: toName } as TMenuItem) : it
          )
      );

      const itemsList =
        snapshot.length
          ? snapshot
          : await getMenuItems(token as string, { locationId: activeLocationId || undefined });

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
        ['categories', token, activeLocationId || 'all'],
        (prev) => (prev ?? []).filter((c) => !removedIds.includes(c.id))
      );

      // keep onboarding flags
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

      queryClient.invalidateQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Categories merged');
      broadcast();
    },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token, activeLocationId || 'all'] });
      queryClient.invalidateQueries({ queryKey: ['categories', token, activeLocationId || 'all'] });
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
    availabilityMut,
  };
}