import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../../context/AuthContext';
import {
  getMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import { getCategories, type Category } from '../../api/categories';

function broadcast() {
  try {
    localStorage.setItem('menu:updated', String(Date.now()));
    localStorage.setItem('categories:updated', String(Date.now()));
  } catch {}
}

export function useMenuItems() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const enabled = !!token;

  // Queries
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

  // Create (cache-first insert)
  const createMut = useMutation({
    mutationFn: async (payload: NewMenuItem) => {
      const price =
        typeof (payload as any).price === 'string'
          ? parseFloat((payload as any).price)
          : (payload as any).price;
      return createMenuItem({ ...payload, price } as NewMenuItem, token as string);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) => [...(prev ?? []), created]);
      broadcast();
    },
  });

  // Update (optimistic + cache-first)
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
      return updateMenuItem(id, payload, token as string);
    },
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (it.id === id ? ({ ...it, ...payload } as TMenuItem) : it))
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (it.id === updated.id ? updated : it))
      );
      broadcast();
    },
  });

  // Toggle availability (optimistic)
  const availabilityMut = useMutation<
    TMenuItem,
    Error,
    { id: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ id, active }) =>
      updateMenuItem(
        id,
        (active
          ? { hidden: false, status: 'active' }
          : { hidden: true, status: 'hidden' }) as unknown as Partial<NewMenuItem>,
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

  // Delete (optimistic remove)
  const deleteMut = useMutation<void, Error, { id: string }, { snapshot: TMenuItem[] }>({
    mutationFn: ({ id }) => deleteMenuItem(id, token as string),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).filter((it) => it.id !== id)
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

  // Duplicate (cache-first insert)
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

  // Bulk: enable/disable (optimistic)
  const bulkAvailabilityMut = useMutation<
    { ids: string[]; active: boolean },
    Error,
    { ids: string[]; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ ids, active }) => {
      await Promise.allSettled(
        ids.map((id) =>
          updateMenuItem(
            id,
            (active
              ? { hidden: false, status: 'active' }
              : { hidden: true, status: 'hidden' }) as unknown as Partial<NewMenuItem>,
            token as string
          )
        )
      );
      return { ids, active };
    },
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
    onSuccess: () => {
      broadcast();
    },
  });

  // Bulk: change category (optimistic)
  const bulkCategoryMut = useMutation<
    { ids: string[]; category?: string },
    Error,
    { ids: string[]; category?: string },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: async ({ ids, category }) => {
      await Promise.allSettled(
        ids.map((id) => updateMenuItem(id, { category } as Partial<NewMenuItem>, token as string))
      );
      return { ids, category };
    },
    onMutate: async ({ ids, category }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) ?? [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev ?? []).map((it) => (ids.includes(it.id) ? ({ ...it, category } as TMenuItem) : it))
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
    bulkCategoryMut,
  };
}