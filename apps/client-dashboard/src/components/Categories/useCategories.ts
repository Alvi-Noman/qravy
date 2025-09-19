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
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import { useAuthContext } from '../../context/AuthContext';
import { toastSuccess, toastError } from '../Toaster';
import type { TenantDTO } from '../../../../../packages/shared/src/types/v1'; // FIX: explicit type import

function broadcast() {
  try {
    localStorage.setItem('categories:updated', String(Date.now()));
    localStorage.setItem('menu:updated', String(Date.now()));
  } catch {}
}

export function useCategories() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const enabled = !!token;

  const categoriesQuery = useQuery<Category[]>({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled,
  });

  const itemsQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
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
      return createCategory(trimmed, token as string);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Category[]>(['categories', token], (prev) =>
        [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name))
      );

      // FIX: ensure both flags exist
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
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (it.category === oldName ? ({ ...it, category: updated.name } as TMenuItem) : it))
      );

      const list =
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ??
        (await getMenuItems(token as string));
      await Promise.allSettled(
        list
          .filter((it) => it.category === oldName)
          .map((it) => updateMenuItem(it.id, { category: updated.name }, token as string))
      );

      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Category[]>(['categories', token], (prev) =>
        (prev ?? [])
          .map((c) => (c.id === updated.id ? updated : c))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      toastSuccess('Category renamed');
      broadcast();
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
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
          queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
        queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
          (prev ?? []).map((it) => (it.category === oldName ? ({ ...it, category: newName } as TMenuItem) : it))
        );

        const itemsList = snapshot.length ? snapshot : await getMenuItems(token as string);
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
      const next = queryClient.setQueryData<Category[]>(['categories', token], (prev) =>
        (prev ?? []).filter((c) => c.id !== id)
      ) as Category[] | undefined;

      const noneLeft = !next || next.length === 0;
      if (noneLeft) {
        // FIX: ensure both flags exist
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

      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Category deleted');
      broadcast();
    },
    onError: (e: any) => {
      toastError(e?.message || 'Failed to delete category');
    },
  });

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
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) =>
          it.category && fromNames.includes(it.category) ? ({ ...it, category: toName } as TMenuItem) : it
        )
      );

      const itemsList = snapshot.length ? snapshot : await getMenuItems(token as string);
      await Promise.allSettled(
        itemsList
          .filter((it) => it.category && fromNames.includes(it.category))
          .map((it) => updateMenuItem(it.id, { category: toName }, token as string))
      );

      await Promise.allSettled(from.map((f) => deleteCategory(f.id, token as string)));

      return { removedIds: from.map((f) => f.id) };
    },
    onSuccess: ({ removedIds }) => {
      queryClient.setQueryData<Category[]>(['categories', token], (prev) =>
        (prev ?? []).filter((c) => !removedIds.includes(c.id))
      );

      // FIX: ensure both flags exist
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

      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      queryClient.invalidateQueries({ queryKey: ['tenant', token] });

      toastSuccess('Categories merged');
      broadcast();
    },
    onError: (e: any) => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      queryClient.invalidateQueries({ queryKey: ['categories', token] });
      toastError(e?.message || 'Failed to merge categories');
    },
  });

  const availabilityMut = useMutation<
    { name: string; active: boolean },
    Error,
    { name: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ name, active }) => {
      const list =
        queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ??
        (await getMenuItems(token as string));
      const targets = list.filter((it) => it.category === name);
      await Promise.allSettled(
        targets.map((it) =>
          updateMenuItem(
            it.id,
            (active ? { hidden: false, status: 'active' } : { hidden: true, status: 'hidden' }) as unknown as Partial<NewMenuItem>,
            token as string
          )
        )
      );
      return { name, active };
    },
    onMutate: async ({ name, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) =>
          it.category === name
            ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as TMenuItem)
            : it
        )
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      broadcast();
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