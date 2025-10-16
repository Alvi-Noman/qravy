/**
 * Categories.tsx
 *
 * A full React component for managing categories. Similar structure to MenuItemsPage,
 * but tailored to categories workflow with empty state inspired by Dashboard (center aligned,
 * icon, title, description, call-to-action).
 */

import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Category } from '../api/categories';
import { getCategoryByName } from '../api/categories';
import { useCategories } from '../components/categories/useCategories';
import { BulkActionsBar } from '../components/categories';
import CategoriesToolbar from '../components/categories/CategoriesToolbar';
import CategoriesToolbarSkeleton from '../components/categories/CategoriesToolbarSkeleton';
import CategoryListSkeleton from '../components/categories/CategoryListSkeleton';
import { TagIcon } from '@heroicons/react/24/outline';
import Can from '../components/Can';
import { usePermissions } from '../context/PermissionsContext';
import { useScope } from '../context/ScopeContext';
import { useAuthContext } from '../context/AuthContext';

const CategoryList = lazy(() => import('../components/categories/CategoryList'));
const CategoryFormDialog = lazy(() => import('../components/categories/CategoryFormDialog'));
const DeleteReassignDialog = lazy(() => import('../components/categories/DeleteReassignDialog'));
const MergeCategoriesDialog = lazy(() => import('../components/categories/MergeCategoriesDialog'));

type SortBy = 'name-asc' | 'created-desc' | 'most-used';

const HIGHLIGHT_HOLD_MS = 2500;
const SHRINK_DISTANCE = 80;

/**
 * Scroll helpers (same as in MenuItemsPage)
 */
function getScrollContainer(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    const scrollable =
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight;
    if (scrollable) return node;
    node = node.parentElement;
  }
  return window;
}
function getScrollTop(scroller: HTMLElement | Window): number {
  if (scroller === window) {
    return (
      window.scrollY ||
      document.documentElement.scrollTop ||
      (document.body ? document.body.scrollTop : 0)
    );
  }
  return (scroller as HTMLElement).scrollTop;
}
function waitForScrollIdle(
  scroller: HTMLElement | Window,
  idleMs = 140,
  maxWaitMs = 2500
): Promise<void> {
  return new Promise((resolve) => {
    let lastTop = getScrollTop(scroller);
    let lastChange = performance.now();
    const deadline = performance.now() + maxWaitMs;
    const tick = () => {
      const now = performance.now();
      const top = getScrollTop(scroller);
      if (top !== lastTop) {
        lastTop = top;
        lastChange = now;
      }
      if (now - lastChange >= idleMs || now >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Main CategoriesPage component
 */
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
    bulkVisibilityMut,
  } = useCategories();

  const { has } = usePermissions();
  const canCreate = has('categories:create');
  const canUpdate = has('categories:update');
  const canDelete = has('categories:delete');
  const canToggleVisibility = has('categories:toggleVisibility');

  const { activeLocationId, channel: scopeChannel } = useScope();
  const { token } = useAuthContext();

  // Read/write URL query to drive Add Category dialog
  const [searchParams, setSearchParams] = useSearchParams();
  const routeWantsNew = searchParams.get('new') === 'category';

  // Auto-open dialog when URL says so (respect capability)
  useEffect(() => {
    if (routeWantsNew) {
      if (canCreate) {
        setEditing(null);
        setOpenForm(true);
      } else {
        const sp = new URLSearchParams(searchParams);
        sp.delete('new');
        setSearchParams(sp, { replace: true });
      }
    }
  }, [routeWantsNew, canCreate, searchParams, setSearchParams]);

  // Storage listener for cross-tab updates
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'categories:updated') categoriesQuery.refetch();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [categoriesQuery]);

  // UI + filter states
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');
  // channels state remains for the toolbar UI only; do not filter the list by channel
  const [channels, setChannels] = useState<Set<'dine-in' | 'online'>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [openForm, setOpenForm] = useState(routeWantsNew && canCreate);
  const [editing, setEditing] = useState<Category | null>(null);
  const [openDelete, setOpenDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [openMerge, setOpenMerge] = useState(false);

  // Freeze + highlight states (for editing/adding)
  const [frozenCategories, setFrozenCategories] = useState<Category[] | null>(
    null
  );
  const sourceCategories = frozenCategories ?? categories;

  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(
    null
  );
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [queuedHighlightId, setQueuedHighlightId] = useState<string | null>(
    null
  );

  // Scroll shrink header
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shrink, setShrink] = useState(0);

  useLayoutEffect(() => {
    const scroller = contentRef.current;
    if (!scroller) return;
    let raf = 0;
    let last = -1;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const onScroll = () => {
      const t = clamp01(scroller.scrollTop / SHRINK_DISTANCE);
      if (t === last) return;
      last = t;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setShrink(t));
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Derived values
  const existingNames = useMemo(
    () => categories.map((c) => c.name),
    [categories]
  );
  const activeByName = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const it of items) {
      const name = (it.category || '').trim();
      if (!name) continue;
      const itAny = it as any;
      const isActive = !(itAny.hidden || itAny.status === 'hidden');
      if (isActive) m.set(name, true);
      else if (!m.has(name)) m.set(name, false);
    }
    return m;
  }, [items]);

  // Keep categories visible; hide only when they don't belong to the selected channel,
  // or when we know all items for that category are off in this channel.
  const viewCategories = useMemo(() => {
    let list = sourceCategories.slice();
    const qnorm = q.trim().toLowerCase();
    if (qnorm) list = list.filter((c) => c.name.toLowerCase().includes(qnorm));

    // In All locations + single channel, apply channelScope + active-state rules
    if (!activeLocationId && (scopeChannel === 'dine-in' || scopeChannel === 'online')) {
      // 1) Channel scope: only show categories whose channelScope is 'all' or matches the selected channel
      list = list.filter((c: any) => {
        const cs = (c?.channelScope as 'all' | 'dine-in' | 'online' | undefined) ?? 'all';
        return cs === 'all' || cs === scopeChannel;
      });
      // 2) Active items: keep categories with no items; hide only when we know all items are off
      // list = list.filter((c) => activeByName.get(c.name) !== false);
    }

    if (sortBy === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc')
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    if (sortBy === 'most-used')
      list.sort((a, b) => (usageMap.get(b.name) ?? 0) - (usageMap.get(a.name) ?? 0));
    return list;
  }, [sourceCategories, q, sortBy, usageMap, activeLocationId, scopeChannel, activeByName]);

  // Highlight logic (auto-scroll + highlight)
  useEffect(() => {
    if (!pendingHighlightId) return;
    const exists = viewCategories.some((c) => c.id === pendingHighlightId);
    if (!exists) return;
    const node = document.querySelector(
      `[data-item-id="${pendingHighlightId}"]`
    ) as HTMLElement | null;
    if (!node) return;
    const scroller = contentRef.current || getScrollContainer(node);
    const before = getScrollTop(scroller);
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const raf = requestAnimationFrame(async () => {
      const after = getScrollTop(scroller);
      const didScroll = after !== before;
      if (didScroll) await waitForScrollIdle(scroller, 140, 2500);
      setHighlightId(pendingHighlightId);
      setPendingHighlightId(null);
      window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingHighlightId, viewCategories]);

  // Freeze list during edit, restore after
  useEffect(() => {
    if (openForm && editing && !frozenCategories) {
      setFrozenCategories(categories);
    }
  }, [openForm, editing, categories, frozenCategories]);

  useEffect(() => {
    if (!openForm && (frozenCategories || queuedHighlightId)) {
      categoriesQuery
        .refetch()
        .catch(() => {})
        .finally(() => {
          if (queuedHighlightId) {
            setHighlightId(queuedHighlightId);
            setQueuedHighlightId(null);
            window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
          }
          setFrozenCategories(null);
        });
    }
  }, [openForm, frozenCategories, queuedHighlightId, categoriesQuery]);

  // Selection helpers
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelectAll = () => {
    if (!viewCategories.length) return;
    const all = viewCategories.every((c) => selectedIds.has(c.id));
    setSelectedIds(
      all ? new Set() : new Set(viewCategories.map((c) => c.id))
    );
  };

  const loading = categoriesQuery.isLoading;

  // ----- Detail query for Advanced defaults when editing -----
  const [detailNonce, setDetailNonce] = useState(0);
  useEffect(() => {
    if (openForm && editing) setDetailNonce((n) => n + 1); // force fresh read each time you open
  }, [openForm, editing?.id]);

  const detailQuery = useQuery({
    queryKey: ['category-detail', token, editing?.name, detailNonce],
    queryFn: () => getCategoryByName(editing!.name, token as string),
    enabled: !!editing && !!token,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: false,
  });

  // Normalize detail → dialog props
  const initialChannelProp =
    (detailQuery.data?.channel as 'dine-in' | 'online' | undefined) ?? 'both';
  const initialIncludedProp = detailQuery.data?.includeLocationIds;
  const initialExcludedProp = detailQuery.data?.excludeLocationIds;

  // Handlers (always pass functions; guard inside by capability)
  const onClickAdd = () => {
    if (!canCreate) return;
    setEditing(null);
    const sp = new URLSearchParams(searchParams);
    sp.set('new', 'category');
    setSearchParams(sp, { replace: false });
    setOpenForm(true);
  };
  const handleToggleAvailability = (category: Category, active: boolean) => {
    if (!canToggleVisibility) return;
    availabilityMut.mutate({ name: category.name, active });
  };
  const handleEdit = (c: Category) => {
    if (!canUpdate) return;
    setEditing(c);
    setOpenForm(true);
  };
  const handleDelete = (c: Category) => {
    if (!canDelete) return;
    setDeleteTarget(c);
    setOpenDelete(true);
  };
  const handleMerge = () => {
    if (!canUpdate) return;
    setOpenMerge(true);
  };
  const handleBulkDelete = () => {
    if (!canDelete) return;
    const firstId = Array.from(selectedIds)[0];
    const target = categories.find((c) => c.id === firstId) || null;
    if (!target) return;
    setDeleteTarget(target);
    setOpenDelete(true);
  };

  const allowBulk = canUpdate || canDelete;

  return (
    <div className="flex h-full flex-col min-h-0">
      <div
        ref={contentRef}
        className="flex-1 min-h-0 overflow-y-auto p-0 text-[#2e2e30] text-sm"
      >
        {/* Header with shrink effect */}
        <div
          className="sticky top-0 z-20 flex items-center justify-between border-b border-[#ececec] px-6"
          style={{
            paddingTop: `${16 - 8 * shrink}px`,
            paddingBottom: `${16 - 8 * shrink}px`,
            backgroundColor: `rgba(252, 252, 252, ${1 - 0.75 * shrink})`,
            WebkitBackdropFilter: 'blur(5px)',
            backdropFilter: 'blur(5px)',
            transition: 'padding 160ms ease, background-color 160ms ease',
          }}
        >
          <h2
            className="text-lg font-semibold text-[#2e2e30]"
            style={{
              transform: `translateY(${2 * shrink}px) scale(${1 - 0.06 * shrink})`,
              transformOrigin: 'left center',
              transition: 'transform 160ms ease',
            }}
          >
            Categories
          </h2>
          <div
            className="flex items-center gap-2"
            style={{
              transform: `scale(${1 - 0.05 * shrink})`,
              transformOrigin: 'right center',
              transition: 'transform 160ms ease',
            }}
          >
            <Can capability="categories:update">
              <Link
                to="/categories/manage"
                className="rounded-md border border-[#cecece] px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
              >
                Manage Category
              </Link>
            </Can>
            <Can capability="categories:create">
              <button
                className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90"
                onClick={onClickAdd}
              >
                Add Category
              </button>
            </Can>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pt-4">
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
                {/* Empty State (Dashboard style) */}
                {!viewCategories.length ? (
                  <div className="flex h-[60vh] flex-col items-center justify-center text-center p-8">
                    <TagIcon className="h-12 w-12 text-slate-400 mb-3" />
                    <h2 className="text-xl font-semibold text-[#2e2e30]">
                      No Categories Yet
                    </h2>
                    <p className="text-sm text-[#6b6b70] mt-2 mb-6 max-w-md">
                      Organize your menu by creating categories. Once added,
                      they'll appear here.
                    </p>
                    <Can capability="categories:create">
                      <button
                        onClick={onClickAdd}
                        className="rounded-md bg-[#2e2e30] text-white px-5 py-2 hover:opacity-90"
                      >
                        Add Category
                      </button>
                    </Can>
                  </div>
                ) : (
                  <Suspense fallback={<CategoryListSkeleton rows={6} />}>
                    <CategoryList
                      categories={viewCategories}
                      usageByName={usageMap}
                      activeByName={activeByName}
                      toggling={availabilityMut.isPending}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      onToggleSelectAll={toggleSelectAll}
                      onToggleAvailability={handleToggleAvailability}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      highlightId={highlightId}
                    />
                  </Suspense>
                )}
              </div>

              {/* Bulk actions + dialogs */}
              {viewCategories.length > 0 && allowBulk && (
                <BulkActionsBar
                  count={selectedIds.size}
                  onClear={() => setSelectedIds(new Set())}
                  onMerge={handleMerge}
                  onDelete={handleBulkDelete}
                />
              )}

              <Suspense fallback={null}>
                {openForm && (editing ? canUpdate : canCreate) && (
                  <CategoryFormDialog
                    open={openForm}
                    title={editing ? 'Rename Category' : 'Add Category'}
                    initialName={editing?.name || ''}
                    existingNames={
                      editing
                        ? existingNames.filter(
                            (n) => n.toLowerCase() !== editing.name.toLowerCase()
                          )
                        : existingNames
                    }
                    isSubmitting={createMut.isPending || renameMut.isPending}
                    /* ✅ pass the id so the dialog can read overlay flags for the current branch */
                    initialCategoryId={editing?.id}
                    // Advanced defaults when editing: reflect true channel/branch rules
                    {...(editing
                      ? {
                          initialChannel:
                            initialChannelProp === 'dine-in' || initialChannelProp === 'online'
                              ? (initialChannelProp as 'dine-in' | 'online')
                              : 'both',
                          // ✅ pass both include and exclude props from detail
                          initialIncludedLocationIds: initialIncludedProp ?? [],
                          initialExcludedLocationIds: initialExcludedProp ?? [],
                        }
                      : {})}
                    onClose={() => {
                      setOpenForm(false);
                      const sp = new URLSearchParams(searchParams);
                      sp.delete('new');
                      setSearchParams(sp, { replace: true });
                    }}
                    onSubmit={async (name, opts) => {
                      if (editing) {
                        // ⬇️ Pass Advanced options through to rename
                        const updated = await renameMut.mutateAsync({
                          id: editing.id,
                          newName: name,
                          opts: {
                            channel: opts?.channel, // 'both' | 'dine-in' | 'online'
                            includeLocationIds: opts?.includeLocationIds,
                            excludeLocationIds: opts?.excludeLocationIds,
                            // pass through if dialog provides hardExclude
                            hardExclude: (opts as any)?.hardExclude,
                          },
                        });
                        setOpenForm(false);
                        const sp = new URLSearchParams(searchParams);
                        sp.delete('new');
                        setSearchParams(sp, { replace: true });
                        setQueuedHighlightId(updated.id);
                      } else {
                        const created = await createMut.mutateAsync({ name, opts });
                        setOpenForm(false);
                        const sp = new URLSearchParams(searchParams);
                        sp.delete('new');
                        setSearchParams(sp, { replace: true });
                        setPendingHighlightId(created.id);
                      }
                    }}
                  />
                )}

                {openDelete && canDelete && (
                  <DeleteReassignDialog
                    open={openDelete}
                    category={deleteTarget}
                    categories={categories}
                    usageCount={deleteTarget ? usageMap.get(deleteTarget.name) ?? 0 : 0}
                    scope={activeLocationId ? 'branch' : 'global'}
                    // Use deleteMut for branch scope too (it hard-deletes branch-scoped categories)
                    isSubmitting={deleteMut.isPending}
                    onClose={() => setOpenDelete(false)}
                    onConfirm={(opts) => {
                      if (!deleteTarget) return;

                      // Branch-scope removal -> call delete API with current scope
                      if ('scope' in opts && opts.scope === 'branch') {
                        deleteMut.mutate(
                          { id: deleteTarget.id, mode: 'cascade' },
                          { onSuccess: () => setOpenDelete(false) }
                        );
                        return;
                      }

                      // Global delete everywhere (cascade or reassign)
                      const { mode, reassignToId } = opts as {
                        mode: 'cascade' | 'reassign';
                        reassignToId?: string;
                      };

                      deleteMut.mutate(
                        { id: deleteTarget.id, mode, reassignToId },
                        { onSuccess: () => setOpenDelete(false) }
                      );
                    }}
                  />
                )}

                {openMerge && canUpdate && (
                  <MergeCategoriesDialog
                    open={openMerge}
                    selectedIds={Array.from(selectedIds)}
                    categories={categories}
                    isSubmitting={(mergeMut as any).isPending || false}
                    onClose={() => setOpenMerge(false)}
                    onConfirm={({ fromIds, toId }) => {
                      setOpenMerge(false);
                      setSelectedIds(new Set());
                      (mergeMut as any).mutate?.({ fromIds, toId });
                    }}
                  />
                )}
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
