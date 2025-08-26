import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Category } from '../api/categories';
import { useCategories } from '../components/Categories/useCategories';
import { BulkActionsBar } from '../components/Categories';
import CategoriesToolbar from '../components/Categories/CategoriesToolbar';
import CategoriesToolbarSkeleton from '../components/Categories/CategoriesToolbarSkeleton';
import CategoryListSkeleton from '../components/Categories/CategoryListSkeleton';

const CategoryList = lazy(() => import('../components/Categories/CategoryList'));
const CategoryFormDialog = lazy(() => import('../components/Categories/CategoryFormDialog'));
const DeleteReassignDialog = lazy(() => import('../components/Categories/DeleteReassignDialog'));
const MergeCategoriesDialog = lazy(() => import('../components/Categories/MergeCategoriesDialog'));

type SortBy = 'name-asc' | 'created-desc' | 'most-used';

export default function CategoriesPage() {
  const {
    categoriesQuery,
    usageMap,
    categories,
    items,
    createMut,
    renameMut,
    deleteMut,
    mergeMut,
    availabilityMut,
  } = useCategories();

  // Cross-tab refresh
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'categories:updated') categoriesQuery.refetch();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [categoriesQuery]);

  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');
  const [channels, setChannels] = useState<Set<'dine-in' | 'online'>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [openDelete, setOpenDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [openMerge, setOpenMerge] = useState(false);

  const existingNames = useMemo(() => categories.map((c) => c.name), [categories]);

  // Compute category "active" if any item in the category is active
  const activeByName = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const it of items) {
      const name = (it.category || '').trim();
      if (!name) continue;
      const itAny = it as unknown as Record<string, any>;
      const isActive = !(itAny.hidden || itAny.status === 'hidden');
      if (isActive) m.set(name, true);
      else if (!m.has(name)) m.set(name, false);
    }
    return m;
  }, [items]);

  const viewCategories = useMemo(() => {
    let list = categories.slice();

    const qnorm = q.trim().toLowerCase();
    if (qnorm) list = list.filter((c) => c.name.toLowerCase().includes(qnorm));

    // Channel filter: include categories that have at least one item visible in selected channels
    if (channels.size > 0) {
      const selected = Array.from(channels);
      list = list.filter((c) =>
        items.some((it) => {
          if (it.category !== c.name) return false;
          const itAny = it as unknown as Record<string, any>;
          return selected.every((ch) => {
            if (ch === 'dine-in') return itAny.visibility?.dineIn !== false;
            if (ch === 'online') return itAny.visibility?.online !== false;
            return true;
          });
        })
      );
    }

    if (sortBy === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc') list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortBy === 'most-used') list.sort((a, b) => (usageMap.get(b.name) ?? 0) - (usageMap.get(a.name) ?? 0));

    return list;
  }, [categories, items, q, channels, sortBy, usageMap]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () => {
    if (!viewCategories.length) return;
    const all = viewCategories.every((c) => selectedIds.has(c.id));
    setSelectedIds(all ? new Set() : new Set(viewCategories.map((c) => c.id)));
  };

  const loading = categoriesQuery.isLoading;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Categories</h2>
        <button
          className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90"
          onClick={() => {
            setEditing(null);
            setOpenForm(true);
          }}
        >
          Add Category
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 text-[#2e2e30] text-sm">
        {loading ? (
          <>
            <CategoriesToolbarSkeleton />
            <div className="mt-4">
              <CategoryListSkeleton rows={6} />
            </div>
          </>
        ) : categoriesQuery.isError ? (
          <div className="text-red-600">Failed to load categories.</div>
        ) : (
          <>
            <CategoriesToolbar
              q={q}
              setQ={setQ}
              channels={channels}
              setChannels={setChannels}
              sortBy={sortBy}
              setSortBy={setSortBy}
            />

            <div className="mt-4 space-y-4">
              <Suspense fallback={<CategoryListSkeleton rows={6} />}>
                <CategoryList
                  categories={viewCategories}
                  usageByName={usageMap}
                  activeByName={activeByName}
                  toggling={availabilityMut.isPending}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
                  onToggleAvailability={(category, active) =>
                    availabilityMut.mutate({ name: category.name, active })
                  }
                  onEdit={(c) => {
                    setEditing(c);
                    setOpenForm(true);
                  }}
                  onDelete={(c) => {
                    setDeleteTarget(c);
                    setOpenDelete(true);
                  }}
                />
              </Suspense>
            </div>

            <BulkActionsBar
              count={selectedIds.size}
              onClear={() => setSelectedIds(new Set())}
              onMerge={() => setOpenMerge(true)}
              onDelete={() => {
                if (selectedIds.size === 1) {
                  const single = categories.find((c) => c.id === Array.from(selectedIds)[0]) || null;
                  setDeleteTarget(single);
                  setOpenDelete(true);
                } else if (selectedIds.size > 1) {
                  setOpenMerge(true);
                }
              }}
            />

            {/* Lazy dialogs */}
            <Suspense fallback={null}>
              <CategoryFormDialog
                open={openForm}
                title={editing ? 'Rename Category' : 'Add Category'}
                initialName={editing?.name || ''}
                existingNames={
                  editing
                    ? existingNames.filter((n) => n.toLowerCase() !== editing.name.toLowerCase())
                    : existingNames
                }
                isSubmitting={createMut.isPending || renameMut.isPending}
                onClose={() => setOpenForm(false)}
                onSubmit={(name) => {
                  if (editing) {
                    renameMut.mutate({ id: editing.id, newName: name }, { onSuccess: () => setOpenForm(false) });
                  } else {
                    createMut.mutate(name, { onSuccess: () => setOpenForm(false) });
                  }
                }}
              />

              <DeleteReassignDialog
                open={openDelete}
                category={deleteTarget}
                categories={categories}
                usageCount={deleteTarget ? usageMap.get(deleteTarget.name) ?? 0 : 0}
                isSubmitting={deleteMut.isPending}
                onClose={() => setOpenDelete(false)}
                onConfirm={({ mode, reassignToId }) => {
                  if (!deleteTarget) return;
                  deleteMut.mutate(
                    { id: deleteTarget.id, mode, reassignToId },
                    { onSuccess: () => setOpenDelete(false) }
                  );
                }}
              />

              <MergeCategoriesDialog
                open={openMerge}
                selectedIds={Array.from(selectedIds)}
                categories={categories}
                isSubmitting={mergeMut.isPending}
                onClose={() => setOpenMerge(false)}
                onConfirm={({ fromIds, toId }) => {
                  setOpenMerge(false);
                  setSelectedIds(new Set());
                  mergeMut.mutate({ fromIds, toId });
                }}
              />
            </Suspense>
          </>
        )}
      </div>
    </div>
  );
}