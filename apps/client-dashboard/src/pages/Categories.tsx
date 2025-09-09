// apps/client-dashboard/src/pages/Categories.tsx
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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

const HIGHLIGHT_HOLD_MS = 2500;
const SHRINK_DISTANCE = 80; // pixels of scroll until fully compact

// Scroll helpers (same pattern as Menu Items)
function getScrollContainer(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    const scrollable =
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight;
    if (scrollable) return node;
    node = node.parentElement;
  }
  return window;
}
function getScrollTop(scroller: HTMLElement | Window): number {
  if (scroller === window) {
    return window.scrollY || document.documentElement.scrollTop || (document.body ? document.body.scrollTop : 0);
  }
  return (scroller as HTMLElement).scrollTop;
}
function waitForScrollIdle(scroller: HTMLElement | Window, idleMs = 140, maxWaitMs = 2500): Promise<void> {
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

  // Highlight states
  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Scroll container + shrink progress
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shrink, setShrink] = useState(0); // 0..1 based on scroll

  // Track shrink progress based on scroll position (same as Menu Items)
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

    onScroll(); // initial
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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
    if (sortBy === 'created-desc')
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortBy === 'most-used')
      list.sort((a, b) => (usageMap.get(b.name) ?? 0) - (usageMap.get(a.name) ?? 0));

    return list;
  }, [categories, items, q, channels, sortBy, usageMap]);

  // When a new/renamed category appears in the filtered+sorted view, scroll and highlight it
  useEffect(() => {
    if (!pendingHighlightId) return;
    const exists = viewCategories.some((c) => c.id === pendingHighlightId);
    if (!exists) return;

    const node = document.querySelector(`[data-item-id="${pendingHighlightId}"]`) as HTMLElement | null;
    if (!node) return;

    const scroller = contentRef.current || getScrollContainer(node);
    const before = getScrollTop(scroller);

    node.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const raf = requestAnimationFrame(async () => {
      const after = getScrollTop(scroller);
      const didScroll = after !== before;

      if (didScroll) {
        await waitForScrollIdle(scroller, 140, 2500);
      }
      setHighlightId(pendingHighlightId);
      setPendingHighlightId(null);
      window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
    });

    return () => cancelAnimationFrame(raf);
  }, [pendingHighlightId, viewCategories]);

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
    <div className="flex h-full flex-col min-h-0">
      <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto p-0 text-[#2e2e30] text-sm">
        {/* Sticky, shrinking, glassy header (matches Menu Items) */}
        <div
          className={[
            'sticky top-0 z-20 flex items-center justify-between border-b border-[#ececec] px-6',
          ].join(' ')}
          style={{
            // Smoothly reduce vertical padding from 16px to 8px as you scroll
            paddingTop: `${16 - 8 * shrink}px`,
            paddingBottom: `${16 - 8 * shrink}px`,
            // Fade background from solid to 25% alpha as you scroll
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
              willChange: 'transform',
            }}
          >
            Categories
          </h2>

          <div
            className="flex items-center gap-2"
            style={{
              transform: `scale(${1 - 0.05 * shrink})`,
              transformOrigin: 'right center',
              willChange: 'transform',
              transition: 'transform 160ms ease',
            }}
          >
            <Link
              to="/categories/manage"
              className="rounded-md border border-[#cecece] px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
            >
              Manage Category
            </Link>
            <button
              className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90 transition-transform"
              onClick={() => {
                setEditing(null);
                setOpenForm(true);
              }}
            >
              Add Category
            </button>
          </div>
        </div>

        {/* Content */}
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
                    highlightId={highlightId}
                  />
                </Suspense>
              </div>

              <BulkActionsBar
                count={selectedIds.size}
                onClear={() => setSelectedIds(new Set())}
                onMerge={() => setOpenMerge(true)}
                onDelete={() => {
                  const firstId = Array.from(selectedIds)[0];
                  const target = categories.find((c) => c.id === firstId) || null;
                  if (!target) return;
                  setDeleteTarget(target);
                  setOpenDelete(true);
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
                  onSubmit={async (name) => {
                    if (editing) {
                      const updated = await renameMut.mutateAsync({ id: editing.id, newName: name });
                      setOpenForm(false);
                      setPendingHighlightId(updated.id);
                    } else {
                      const created = await createMut.mutateAsync(name);
                      setOpenForm(false);
                      setPendingHighlightId(created.id);
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
    </div>
  );
}