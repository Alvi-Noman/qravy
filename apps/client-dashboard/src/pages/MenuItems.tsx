/**
 * Menu items page wiring Drawer with optional price when variants priced
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMenuItems } from '../components/MenuItems/useMenuItems';
import MenuToolbar, { type SortBy } from '../components/MenuItems/MenuToolbar';
import MenuToolbarSkeleton from '../components/MenuItems/MenuToolbarSkeleton';
import MenuTableSkeleton from '../components/MenuItems/MenuTableSkeleton';
import BulkActionsBar from '../components/MenuItems/BulkActionsBar';
import type { MenuItem as TMenuItem, NewMenuItem } from '../api/menu';

const MenuTable = lazy(() => import('../components/MenuItems/MenuTable'));
const BulkChangeCategoryDialog = lazy(() => import('../components/MenuItems/BulkChangeCategoryDialog'));
const ConfirmDeleteItemsDialog = lazy(() => import('../components/MenuItems/ConfirmDeleteItemsDialog'));
const ProductDrawer = lazy(() => import('../components/AddProductDrawer/ProductDrawer'));

type Status = 'active' | 'hidden';
type Channel = 'dine-in' | 'online';

type DrawerSubmitValues = {
  name: string;
  price?: number;
  compareAtPrice?: number;
  category?: string;
  description?: string;
  media?: string[];
  variations?: { name: string; price?: number; imageUrl?: string }[];
  tags?: string[];
};

const HIGHLIGHT_HOLD_MS = 2500;
const SHRINK_DISTANCE = 80; // pixels of scroll until fully compact

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

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === 'menu:updated' && itemsQuery.refetch();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [itemsQuery]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Set<Status>>(new Set());
  const [channels, setChannels] = useState<Set<Channel>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState<TMenuItem | null>(null);
  const [openBulkCategory, setOpenBulkCategory] = useState(false);
  const [openDeleteMany, setOpenDeleteMany] = useState(false);

  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shrink, setShrink] = useState(0); // 0..1 based on scroll

  // Track shrink progress based on scroll position
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

  const loading = itemsQuery.isLoading || categoriesQuery.isLoading;

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
    if (sortBy === 'created-desc') {
      list = list
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
    }
    if (sortBy === 'most-used') {
      list = list
        .slice()
        .sort(
          (a: any, b: any) =>
            (b.usageCount || b.ordersCount || 0) - (a.usageCount || a.ordersCount || 0)
        );
    }
    return list;
  }, [items, q, status, channels, selectedCategory, sortBy]);

  useEffect(() => {
    if (!pendingHighlightId) return;
    const exists = viewItems.some((it) => it.id === pendingHighlightId);
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
  }, [pendingHighlightId, viewItems]);

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

  return (
    <div className="flex h-full flex-col min-h-0">
      <div
        ref={contentRef}
        className="flex-1 min-h-0 overflow-y-auto p-0 text-[#2e2e30] text-sm"
      >
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
            Menu Items
          </h2>
          <button
            className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90 transition-transform"
            style={{
              transform: `scale(${1 - 0.05 * shrink})`,
              transformOrigin: 'right center',
              willChange: 'transform',
            }}
            onClick={() => setOpenAdd(true)}
          >
            Add Product
          </button>
        </div>

        <div className="px-6 pt-4">
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
                    highlightId={highlightId}
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

              <Suspense fallback={null}>
                <AnimatePresence initial={false} mode="wait">
                  {openAdd && (
                    <ProductDrawer
                      key="add"
                      title="Add Product"
                      categories={categoryNames}
                      initial={{
                        name: '',
                        price: '',
                        category: '',
                        description: '',
                        imagePreviews: [],
                        tags: [],
                        variations: [],
                      }}
                      onClose={() => setOpenAdd(false)}
                      persistKey="add"
                      onSubmit={async (values: DrawerSubmitValues) => {
                        const payload: NewMenuItem = {
                          name: values.name,
                          category: values.category || undefined,
                          description: values.description || undefined,
                          compareAtPrice: values.compareAtPrice,
                          media: values.media,
                          variations: values.variations,
                          tags: values.tags,
                        };
                        if (typeof values.price === 'number') payload.price = values.price;

                        const created = await createMut.mutateAsync(payload);
                        setPendingHighlightId((created as any).id);
                      }}
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
                        compareAtPrice:
                          (openEdit as any).compareAtPrice != null
                            ? String((openEdit as any).compareAtPrice)
                            : '',
                        category: openEdit.category || '',
                        description: (openEdit as any).description || '',
                        imagePreviews: (openEdit as any).media || [],
                        tags: (openEdit as any).tags || [],
                        variations:
                          ((openEdit as any).variations || []).map((v: any) => ({
                            label: v.name,
                            price: v.price != null ? String(v.price) : '',
                            imagePreview: v.imageUrl || null,
                          })) || [],
                      }}
                      onClose={() => setOpenEdit(null)}
                      persistKey={`edit:${(openEdit as any).id}`}
                      onSubmit={async (values: DrawerSubmitValues) => {
                        if (!openEdit) return;
                        const editingId = (openEdit as any).id;
                        const payload: Partial<NewMenuItem> = {
                          name: values.name,
                          category: values.category || undefined,
                          description: values.description || undefined,
                          compareAtPrice: values.compareAtPrice,
                          media: values.media,
                          variations: values.variations,
                          tags: values.tags,
                        };
                        if (typeof values.price === 'number') payload.price = values.price;
                        await updateMut.mutateAsync({ id: editingId, payload });
                        setPendingHighlightId(editingId);
                      }}
                    />
                  )}
                </AnimatePresence>

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
    </div>
  );
}