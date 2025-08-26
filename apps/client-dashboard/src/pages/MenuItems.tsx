import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMenuItems } from '../components/MenuItems/useMenuItems';
import MenuToolbar, { type SortBy } from '../components/MenuItems/MenuToolbar';
import MenuToolbarSkeleton from '../components/MenuItems/MenuToolbarSkeleton';
import MenuTableSkeleton from '../components/MenuItems/MenuTableSkeleton';
import BulkActionsBar from '../components/MenuItems/BulkActionsBar';
import type { MenuItem as TMenuItem } from '../api/menu';

const MenuTable = lazy(() => import('../components/MenuItems/MenuTable'));
const BulkChangeCategoryDialog = lazy(() => import('../components/MenuItems/BulkChangeCategoryDialog'));
const ConfirmDeleteItemsDialog = lazy(() => import('../components/MenuItems/ConfirmDeleteItemsDialog'));
const ProductDrawer = lazy(() => import('../components/AddProductDrawer/ProductDrawer'));

type Status = 'active' | 'hidden';
type Channel = 'dine-in' | 'online';

type DrawerSubmitValues = {
  name: string;
  price: number;
  category?: string;
  description?: string;
};

export default function MenuItemsPage(): JSX.Element {
  const {
    itemsQuery,
    categoriesQuery,
    items,
    categoryNames,
    createMut,
    updateMut,
    deleteMut,
    duplicateMut,
    availabilityMut,
    bulkAvailabilityMut,
    bulkCategoryMut,
  } = useMenuItems();

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === 'menu:updated' && itemsQuery.refetch();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [itemsQuery]);

  // Filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Set<Status>>(new Set());
  const [channels, setChannels] = useState<Set<Channel>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drawers/dialogs
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<TMenuItem | null>(null);
  const [openBulkCategory, setOpenBulkCategory] = useState(false);
  const [openDeleteMany, setOpenDeleteMany] = useState(false);

  const viewItems = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    let list = items.filter((it) => {
      const itAny = it as any;
      const matchesQ =
        !qnorm ||
        it.name.toLowerCase().includes(qnorm) ||
        (it.description || '').toLowerCase().includes(qnorm) ||
        (it.category || '').toLowerCase().includes(qnorm);

      const matchesCategory = !selectedCategory || it.category === selectedCategory;

      const matchesChannels =
        channels.size === 0 ||
        Array.from(channels).every((ch) => {
          if (ch === 'dine-in') return itAny.visibility?.dineIn !== false;
          if (ch === 'online') return itAny.visibility?.online !== false;
          return true;
        });

      const isHidden = itAny.hidden || itAny.status === 'hidden';
      const matchesStatus = status.size === 0 || status.has(isHidden ? 'hidden' : 'active');

      return matchesQ && matchesCategory && matchesChannels && matchesStatus;
    });

    if (sortBy === 'name-asc') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc')
      list = list
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
    if (sortBy === 'most-used')
      list = list
        .slice()
        .sort(
          (a: any, b: any) => (b.usageCount || b.ordersCount || 0) - (a.usageCount || a.ordersCount || 0)
        );
    return list;
  }, [items, q, status, channels, selectedCategory, sortBy]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () => {
    if (!viewItems.length) return;
    const all = viewItems.every((it) => selectedIds.has(it.id));
    setSelectedIds(all ? new Set() : new Set(viewItems.map((it) => it.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const loading = itemsQuery.isLoading || categoriesQuery.isLoading;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Menu Items</h2>
        <button
          className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90"
          onClick={() => setOpenAdd(true)}
        >
          Add Product
        </button>
      </div>

      <div className="flex-1 p-6 text-[#2e2e30] text-sm">
        {loading ? (
          <>
            <MenuToolbarSkeleton />
            <div className="mt-4">
              <MenuTableSkeleton rows={6} />
            </div>
          </>
        ) : itemsQuery.isError ? (
          <div className="text-red-600">Failed to load menu.</div>
        ) : (
          <>
            <MenuToolbar
              q={q}
              setQ={setQ}
              status={status}
              setStatus={setStatus}
              channels={channels}
              setChannels={setChannels}
              categories={categoryNames}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              sortBy={sortBy}
              setSortBy={setSortBy}
            />

            <div className="mt-4 space-y-4">
              <Suspense fallback={<MenuTableSkeleton rows={6} />}>
                <MenuTable
                  items={viewItems}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
                  onToggleAvailability={(id, active) => availabilityMut.mutate({ id, active })}
                  onEdit={(item) => setOpenEdit(item)}
                  onDuplicate={(id) => duplicateMut.mutate(id)}
                  onDelete={(id) => {
                    if (confirm('Delete this item?')) deleteMut.mutate({ id });
                  }}
                />
              </Suspense>
            </div>

            <BulkActionsBar
              count={selectedIds.size}
              onSetAvailable={() => {
                const ids = Array.from(selectedIds);
                if (ids.length) bulkAvailabilityMut.mutate({ ids, active: true });
              }}
              onSetUnavailable={() => {
                const ids = Array.from(selectedIds);
                if (ids.length) bulkAvailabilityMut.mutate({ ids, active: false });
              }}
              onAssignCategory={() => setOpenBulkCategory(true)}
              onDelete={() => setOpenDeleteMany(true)}
              onClear={clearSelection}
            />

            {/* Drawers/Dialogs */}
            <Suspense fallback={null}>
              {openAdd && (
                <ProductDrawer
                  key="add"
                  title="Add Product"
                  categories={categoryNames}
                  initial={{ name: '', price: '', category: '', description: '' }}
                  onClose={() => setOpenAdd(false)}
                  onSubmit={(values: DrawerSubmitValues) =>
                    createMut.mutate(
                      {
                        name: values.name,
                        price: values.price,
                        category: values.category,
                        description: values.description,
                      } as any,
                      { onSuccess: () => setOpenAdd(false) }
                    )
                  }
                />
              )}

              {openEdit && (
                <ProductDrawer
                  key="edit"
                  title="Edit Product"
                  categories={categoryNames}
                  initial={{
                    name: openEdit.name,
                    price: String((openEdit as any).price ?? ''),
                    category: openEdit.category || '',
                    description: openEdit.description || '',
                  }}
                  onClose={() => setOpenEdit(null)}
                  onSubmit={(values: DrawerSubmitValues) => {
                    if (!openEdit) return;
                    updateMut.mutate(
                      {
                        id: (openEdit as any).id,
                        payload: {
                          name: values.name,
                          price: values.price,
                          category: values.category || undefined,
                          description: values.description || undefined,
                        },
                      },
                      { onSuccess: () => setOpenEdit(null) }
                    );
                  }}
                />
              )}

              <BulkChangeCategoryDialog
                open={openBulkCategory}
                categories={categoryNames}
                onClose={() => setOpenBulkCategory(false)}
                onConfirm={(category) => {
                  const ids = Array.from(selectedIds);
                  if (!ids.length) return setOpenBulkCategory(false);
                  bulkCategoryMut.mutate(
                    { ids, category },
                    {
                      onSuccess: () => {
                        setOpenBulkCategory(false);
                        clearSelection();
                      },
                    }
                  );
                }}
                isSubmitting={bulkCategoryMut.isPending}
              />

              <ConfirmDeleteItemsDialog
                open={openDeleteMany}
                count={selectedIds.size}
                onClose={() => setOpenDeleteMany(false)}
                onConfirm={() => {
                  const ids = Array.from(selectedIds);
                  Promise.allSettled(ids.map((id) => deleteMut.mutateAsync({ id }))).finally(() => {
                    clearSelection();
                    setOpenDeleteMany(false);
                  });
                }}
                isSubmitting={deleteMut.isPending}
              />
            </Suspense>
          </>
        )}
      </div>
    </div>
  );
}