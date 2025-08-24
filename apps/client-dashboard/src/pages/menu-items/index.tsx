import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMenuItem,
  getMenuItems,
  updateMenuItem,
  deleteMenuItem,
  type MenuItem as TMenuItem,
  type NewMenuItem,
} from '../../api/menu';
import { getCategories, type Category } from '../../api/categories';
import { useAuthContext } from '../../context/AuthContext';
import ProductDrawer from '../../components/ProductDrawer';
import MenuItemsToolbar from '../../components/menu-items/MenuItemsToolbar';
import MenuItemsTable from '../../components/menu-items/MenuItemsTable';

/** Filter model kept at page-level. */
type Filters = {
  status: Set<'active' | 'hidden'>;
  channels: Set<'dine-in' | 'online'>;
  categories: Set<string>;
};

export default function MenuItemsPage(): JSX.Element {
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<null | TMenuItem>(null);

  const queryClient = useQueryClient();
  const { token } = useAuthContext();

  const itemsQuery = useQuery({
    queryKey: ['menu-items', token],
    queryFn: () => getMenuItems(token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', token],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const categories = (categoriesQuery.data || []).map((c: Category) => c.name);

  // Cross-tab refresh on storage broadcast.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'menu:updated') {
        queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient, token]);

  const createMut = useMutation<TMenuItem, Error, NewMenuItem>({
    mutationFn: (payload) => createMenuItem(payload, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      setOpenAdd(false);
    },
  });

  const updateMut = useMutation<TMenuItem, Error, { id: string; payload: Partial<NewMenuItem> }>({
    mutationFn: ({ id, payload }) => updateMenuItem(id, payload, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
      setOpenEdit(null);
    },
  });

  // Availability toggle (optimistic, typed mutation context)
  const availabilityMut = useMutation<
    TMenuItem,
    Error,
    { id: string; active: boolean },
    { snapshot: TMenuItem[] }
  >({
    mutationFn: ({ id, active }) =>
      updateMenuItem(
        id,
        { ...(active ? { hidden: false, status: 'active' } : { hidden: true, status: 'hidden' }) } as any,
        token as string
      ),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['menu-items', token] });
      const snapshot = queryClient.getQueryData<TMenuItem[]>(['menu-items', token]) || [];
      queryClient.setQueryData<TMenuItem[]>(['menu-items', token], (prev) =>
        (prev || []).map((it) =>
          it.id === id ? ({ ...it, hidden: !active, status: active ? 'active' : 'hidden' } as any) : it
        )
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['menu-items', token], ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
    },
  });

  const deleteMut = useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => deleteMenuItem(id, token as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items', token] });
    },
  });

  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<'name-asc' | 'created-desc' | 'most-used'>('name-asc');
  const [filters, setFilters] = useState<Filters>({
    status: new Set(),
    channels: new Set(),
    categories: new Set(),
  });

  // Derived rows after filters + search + sort
  const viewItems = useMemo(() => {
    const list: TMenuItem[] = itemsQuery.data || [];
    const qnorm = q.trim().toLowerCase();
    let filtered = list.filter((it) => {
      const itAny = it as any;
      const matchesQ =
        !qnorm ||
        it.name.toLowerCase().includes(qnorm) ||
        (it.description || '').toLowerCase().includes(qnorm) ||
        (it.category || '').toLowerCase().includes(qnorm);

      const matchesChannels =
        filters.channels.size === 0 ||
        Array.from(filters.channels).every((ch) => {
          if (ch === 'dine-in') return itAny.visibility?.dineIn !== false;
          if (ch === 'online') return itAny.visibility?.online !== false;
          return true;
        });

      const matchesStatus =
        filters.status.size === 0 ||
        filters.status.has((itAny.hidden || itAny.status === 'hidden') ? 'hidden' : 'active');

      const matchesCategory =
        filters.categories.size === 0 || (it.category && filters.categories.has(it.category));

      return matchesQ && matchesChannels && matchesStatus && matchesCategory;
    });

    if (sortBy === 'name-asc') filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc')
      filtered = filtered
        .slice()
        .sort((a, b) => new Date((b as any).createdAt || 0).getTime() - new Date((a as any).createdAt || 0).getTime());
    if (sortBy === 'most-used')
      filtered = filtered
        .slice()
        .sort(
          (a, b) =>
            ((b as any).usageCount || (b as any).ordersCount || 0) -
            ((a as any).usageCount || (a as any).ordersCount || 0)
        );

    return filtered;
  }, [itemsQuery.data, q, filters, sortBy]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Menu Items</h2>
        <button className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90" onClick={() => setOpenAdd(true)}>
          Add Product
        </button>
      </div>

      <div className="flex-1 p-6 text-[#2e2e30]">
        {itemsQuery.isLoading && <div className="text-[#5b5b5d]">Loading menu…</div>}
        {itemsQuery.isError && <div className="text-red-600">Failed to load menu.</div>}

        {!itemsQuery.isLoading && !itemsQuery.isError && (
          <>
            {(!itemsQuery.data || itemsQuery.data.length === 0) ? (
              <EmptyState onAdd={() => setOpenAdd(true)} />
            ) : (
              <div className="space-y-4">
                <MenuItemsToolbar
                  q={q}
                  setQ={setQ}
                  filters={filters}
                  setFilters={setFilters}
                  categories={categories}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                />

                <MenuItemsTable
                  items={viewItems}
                  onToggleAvailability={(id, active) => availabilityMut.mutate({ id, active })}
                  onEdit={(item) => setOpenEdit(item)}
                  onDelete={(id) => {
                    if (confirm('Delete this item?')) deleteMut.mutate({ id });
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {openAdd && (
          <ProductDrawer
            key="add"
            title="Add Product"
            categories={categories}
            initial={{ name: '', price: '', category: '', description: '' }}
            onClose={() => setOpenAdd(false)}
            onSubmit={(values) => createMut.mutate(values)}
          />
        )}
        {openEdit && (
          <ProductDrawer
            key="edit"
            title="Edit Product"
            categories={categories}
            initial={{
              name: openEdit.name,
              price: String(openEdit.price),
              category: openEdit.category || '',
              description: openEdit.description || '',
            }}
            onClose={() => setOpenEdit(null)}
            onSubmit={(values) =>
              updateMut.mutate({
                id: openEdit.id,
                payload: {
                  name: values.name,
                  price: Number(values.price),
                  category: values.category || undefined,
                  description: values.description || undefined,
                },
              })
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Empty state. */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-2 text-xl font-medium">No products yet</div>
        <p className="mb-4 text-[#5b5b5d]">Create your first menu item to get started.</p>
        <button className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90" onClick={onAdd}>
          Add Product
        </button>
      </div>
    </div>
  );
}