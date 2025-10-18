/**
 * MenuItemsPage.tsx
 *
 * A full React component for managing menu items.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { useMenuItems } from '../components/menu-items/useMenuItems';
import MenuToolbar, { type SortBy } from '../components/menu-items/MenuToolbar';
import MenuToolbarSkeleton from '../components/menu-items/MenuToolbarSkeleton';
import MenuTableSkeleton from '../components/menu-items/MenuTableSkeleton';
import BulkActionsBar from '../components/menu-items/BulkActionsBar';
import { getMenuItems, type MenuItem as TMenuItem, type NewMenuItem } from '../api/menuItems';
import { useSearchParams } from 'react-router-dom';
import Can from '../components/Can';
import { usePermissions } from '../context/PermissionsContext';
import { useAuthContext } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';

const MenuTable = lazy(() => import('../components/menu-items/MenuTable'));
const BulkChangeCategoryDialog = lazy(() => import('../components/menu-items/BulkChangeCategoryDialog'));
const ConfirmDeleteItemsDialog = lazy(() => import('../components/menu-items/ConfirmDeleteItemsDialog'));
const ProductDrawer = lazy(() => import('../components/add-product-drawer/ProductDrawer'));

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
  // Advanced from drawer
  channel?: Channel;                // if single channel selected
  includeLocationIds?: string[];    // only show in these branches (global item)
  excludeLocationIds?: string[];    // hide in these branches (global item)

  // ⬇️ ONLY ADDITIONS BELOW (forwarded as-is to the API)
  excludeChannel?: Channel;                 // exclude channel globally
  excludeAtLocationIds?: string[];         // exclude item at these locations (both channels)
  excludeChannelAt?: Channel;              // which channel to exclude at locations
  excludeChannelAtLocationIds?: string[];  // locations for that channel exclusion
};

const HIGHLIGHT_HOLD_MS = 2500;
const SHRINK_DISTANCE = 80;

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
    bulkDeleteMut, // ensure this is exported by useMenuItems
    bulkCategoryMut,
  } = useMenuItems();

  const { has } = usePermissions();
  const canCreate = has('menuItems:create');
  const canUpdate = has('menuItems:update');
  const canDelete = has('menuItems:delete');
  const canToggleAvailability = has('menuItems:toggleAvailability');

  const [searchParams, setSearchParams] = useSearchParams();
  const routeWantsNew = searchParams.get('new') === 'product';

  useEffect(() => {
    if (routeWantsNew) {
      if (canCreate) setOpenAdd(true);
      else {
        const sp = new URLSearchParams(searchParams);
        sp.delete('new');
        setSearchParams(sp, { replace: true });
      }
    }
  }, [routeWantsNew, canCreate, searchParams, setSearchParams]);

  const queryClient = useQueryClient();

  useEffect(() => {
    const refetchMenu = () => {
      itemsQuery.refetch();
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey as any[];
          return Array.isArray(k) && k[0] === 'menu-items';
        },
      });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'menu:updated') {
        refetchMenu();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('menu:updated' as any, refetchMenu as any);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('menu:updated' as any, refetchMenu as any);
    };
  }, [itemsQuery, queryClient]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Set<Status>>(new Set());
  // ⬇️ removed local channels state; we derive it from ScopeContext instead
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [openAdd, setOpenAdd] = useState(routeWantsNew && canCreate);
  const [openEdit, setOpenEdit] = useState<TMenuItem | null>(null);
  const [openBulkCategory, setOpenBulkCategory] = useState(false);

  // New: dialog control for deletes
  const [openDeleteOne, setOpenDeleteOne] = useState(false);
  const [deleteOneId, setDeleteOneId] = useState<string | null>(null);
  const [openDeleteMany, setOpenDeleteMany] = useState(false);

  const [frozenItems, setFrozenItems] = useState<TMenuItem[] | null>(null);
  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [queuedHighlightId, setQueuedHighlightId] = useState<string | null>(null);

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
  }, []);

  const loading =
    itemsQuery.isLoading ||
    categoriesQuery.isLoading ||
    (itemsQuery.isFetching && !itemsQuery.isLoading) ||
    (categoriesQuery.isFetching && !categoriesQuery.isLoading);

  // Pull channel + setter from scope, and derive pills from it
  const { activeLocationId, channel, setChannel } = useScope(); // backend handles channel visibility
  const sourceItems = frozenItems ?? items;

  // Derived pills from scope (read-only view of current scope)
  const channels = useMemo(() => {
    const s = new Set<Channel>();
    if (channel === 'all') {
      s.add('dine-in');
      s.add('online');
    } else if (channel === 'dine-in' || channel === 'online') {
      s.add(channel);
    }
    return s;
  }, [channel]);

  // Writer for pills → updates the scope (single source of truth)
  const setChannels = (next: Set<Channel>) => {
    const hasDI = next.has('dine-in');
    const hasON = next.has('online');
    const nextScope = hasDI && hasON ? 'all' : hasDI ? 'dine-in' : hasON ? 'online' : 'all';
    if (nextScope !== channel) setChannel(nextScope as any);
  };

  const viewItems = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    let list = sourceItems.filter((it) => {
      const itAny = it as any;
      const matchesQ =
        !qnorm ||
        it.name.toLowerCase().includes(qnorm) ||
        (it.description || '').toLowerCase().includes(qnorm) ||
        (it.category || '').toLowerCase().includes(qnorm);
      const matchesCategory = !selectedCategory || it.category === selectedCategory;

      const isHidden = itAny.hidden || itAny.status === 'hidden';
      const matchesStatus = status.size === 0 || status.has(isHidden ? 'hidden' : 'active');
      return matchesQ && matchesCategory && matchesStatus;
    });

    // Do not apply any additional client-side channel filtering.
    // The backend already enforces baseline visibility per scope/channel.

    if (sortBy === 'name-asc') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc') {
      list = list
        .slice()
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    if (sortBy === 'most-used') {
      list = list
        .slice()
        .sort((a: any, b: any) => (b.usageCount || b.ordersCount || 0) - (a.usageCount || a.ordersCount || 0));
    }
    return list;
  }, [sourceItems, q, status, selectedCategory, sortBy]);

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
      if (didScroll) await waitForScrollIdle(scroller, 140, 2500);
      setHighlightId(pendingHighlightId);
      setPendingHighlightId(null);
      window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingHighlightId, viewItems]);

  useEffect(() => {
    if (openEdit && !frozenItems) {
      setFrozenItems(items);
    }
  }, [openEdit, items, frozenItems]);

  useEffect(() => {
    if (!openEdit && (frozenItems || queuedHighlightId)) {
      itemsQuery
        .refetch()
        .catch(() => {})
        .finally(() => {
          if (queuedHighlightId) {
            setHighlightId(queuedHighlightId);
            setQueuedHighlightId(null);
            window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
          }
          setFrozenItems(null);
        });
    }
  }, [openEdit, frozenItems, queuedHighlightId, itemsQuery]);

  // Selection helpers
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

  // Indicators for channel alerts
  const { token, session } = useAuthContext();
  const persistedLocationId = typeof window !== 'undefined' ? localStorage.getItem('scope:activeLocationId') : null;
  const sessionLocationId = session?.locationId || null;
  const locationIdForQuery = activeLocationId ?? persistedLocationId ?? sessionLocationId ?? undefined;
  const lidKey = locationIdForQuery || 'all';

  const dineInQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token, lidKey, 'dine-in', 'indicator'],
    queryFn: () => getMenuItems(token as string, { locationId: locationIdForQuery, channel: 'dine-in' }),
    enabled: !!token,
    placeholderData: undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const onlineQuery = useQuery<TMenuItem[]>({
    queryKey: ['menu-items', token, lidKey, 'online', 'indicator'],
    queryFn: () => getMenuItems(token as string, { locationId: locationIdForQuery, channel: 'online' }),
    enabled: !!token,
    placeholderData: undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  let dineInExclusiveOff = false;
  let onlineExclusiveOff = false;

  if (activeLocationId) {
    const dItems = dineInQuery.data ?? [];
    const oItems = onlineQuery.data ?? [];
    const dMap = new Map(dItems.map((x: any) => [x.id, !(x.hidden || x.status === 'hidden')]));
    const oMap = new Map(oItems.map((x: any) => [x.id, !(x.hidden || x.status === 'hidden')]));
    const commonIds = [...dMap.keys()].filter((id) => oMap.has(id));

    for (const id of commonIds) {
      const dActive = dMap.get(id) === true;
      const oActive = oMap.get(id) === true;
      if (!dActive && oActive) dineInExclusiveOff = true;
      if (!oActive && dActive) onlineExclusiveOff = true;
      if (dineInExclusiveOff && onlineExclusiveOff) break;
    }
  }
  // All locations -> keep both flags false (no dots)

  // Handlers
  const handleAddClick = () => {
    if (!canCreate) return;
    const sp = new URLSearchParams(searchParams);
    sp.set('new', 'product');
    setSearchParams(sp, { replace: false });
    setOpenAdd(true);
  };
  const handleToggleAvailability = (id: string, active: boolean) => {
    if (!canToggleAvailability) return;
    availabilityMut.mutate(
      { id, active },
      {
        onSuccess: () => {
          if (!active) setStatus(new Set()); // keep unavailable rows visible
        },
      }
    );
  };
  const handleEdit = (item: TMenuItem) => {
    if (!canUpdate) return;
    setOpenEdit(item);
  };
  const handleDuplicate = (id: string) => {
    if (!canCreate) return;
    duplicateMut.mutate(id);
  };

  // Open single-delete dialog
  const handleDelete = (id: string) => {
    if (!canDelete) return;
    setDeleteOneId(id);
    setOpenDeleteOne(true);
  };

  // Bulk handlers
  const onSetAvailable = () => {
    if (!canToggleAvailability) return;
    const ids = Array.from(selectedIds);
    if (ids.length) bulkAvailabilityMut.mutate({ ids, active: true });
  };
  const onSetUnavailable = () => {
    if (!canToggleAvailability) return;
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    bulkAvailabilityMut.mutate(
      { ids, active: false },
      {
        onSuccess: () => {
          setStatus(new Set()); // keep unavailable rows visible
        },
      }
    );
  };
  const onAssignCategory = () => {
    if (!canUpdate) return;
    setOpenBulkCategory(true);
  };
  const onBulkDelete = () => {
    if (!canDelete) return;
    setOpenDeleteMany(true);
  };

  const showBulkBar = viewItems.length > 0;
  const isBranchView = !!activeLocationId;

  return (
    <div className="flex h-full flex-col min-h-0">
      <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto p-0 text-[#2e2e30] text-sm">
        {/* Header */}
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
              willChange: 'transform',
            }}
          >
            Menu Items
          </h2>

          <Can capability="menuItems:create">
            <button
              className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90 transition-transform"
              style={{
                transform: `scale(${1 - 0.05 * shrink})`,
                transformOrigin: 'right center',
                willChange: 'transform',
              }}
              onClick={handleAddClick}
            >
              Add Product
            </button>
          </Can>
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
                channelAlerts={{ dineIn: dineInExclusiveOff, online: onlineExclusiveOff }}
              />

              <div className="mt-4 space-y-4">
                {!viewItems.length ? (
                  <div className="flex h-[60vh] flex-col items-center justify-center text-center p-8">
                    <Squares2X2Icon className="h-12 w-12 text-slate-400 mb-3" />
                    <h2 className="text-xl font-semibold text-[#2e2e30]">No Menu Items Yet</h2>
                    <p className="text-sm text-[#6b6b70] mt-2 mb-6 max-w-md">
                      Get started by adding your first product. Menu items will appear here once created.
                    </p>
                    <Can capability="menuItems:create">
                      <button
                        onClick={handleAddClick}
                        className="rounded-md bg-[#2e2e30] text-white px-5 py-2 hover:opacity-90"
                      >
                        Add Product
                      </button>
                    </Can>
                  </div>
                ) : (
                  <Suspense fallback={<MenuTableSkeleton rows={6} />}>
                    <MenuTable
                      items={viewItems}
                      highlightId={highlightId}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      onToggleSelectAll={toggleSelectAll}
                      onToggleAvailability={handleToggleAvailability}
                      onEdit={handleEdit}
                      onDuplicate={handleDuplicate}
                      onDelete={handleDelete}
                    />
                  </Suspense>
                )}
              </div>

              {showBulkBar && (
                <BulkActionsBar
                  count={selectedIds.size}
                  onSetAvailable={onSetAvailable}
                  onSetUnavailable={onSetUnavailable}
                  onAssignCategory={onAssignCategory}
                  onDelete={onBulkDelete}
                  onClear={clearSelection}
                />
              )}

              <Suspense fallback={null}>
                <AnimatePresence mode="wait">
                  {openAdd && canCreate && (
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
                      onClose={() => {
                        setOpenAdd(false);
                        const sp = new URLSearchParams(searchParams);
                        sp.delete('new');
                        setSearchParams(sp, { replace: true });
                      }}
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

                        // Forward Advanced selections
                        if (values.channel) payload.channel = values.channel;
                        if (values.includeLocationIds?.length) payload.includeLocationIds = values.includeLocationIds;
                        if (values.excludeLocationIds?.length) payload.excludeLocationIds = values.excludeLocationIds;

                        // ⬇️ ONLY NEW FORWARDING (exclusion fields)
                        if (values.excludeChannel) (payload as any).excludeChannel = values.excludeChannel;
                        if (values.excludeAtLocationIds?.length)
                          (payload as any).excludeAtLocationIds = values.excludeAtLocationIds;
                        if (values.excludeChannelAt) (payload as any).excludeChannelAt = values.excludeChannelAt;
                        if (values.excludeChannelAtLocationIds?.length)
                          (payload as any).excludeChannelAtLocationIds = values.excludeChannelAtLocationIds;

                        const created = await createMut.mutateAsync(payload);
                        const sp = new URLSearchParams(searchParams);
                        sp.delete('new');
                        setSearchParams(sp, { replace: true });
                        setPendingHighlightId((created as any).id);
                      }}
                    />
                  )}

                  {openEdit && canUpdate && (
                    <ProductDrawer
                      key="edit"
                      title="Edit Product"
                      categories={categoryNames}
                      initial={{
                        name: openEdit.name,
                        price: String((openEdit as any).price ?? ''),
                        compareAtPrice:
                          (openEdit as any).compareAtPrice != null ? String((openEdit as any).compareAtPrice) : '',
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

                        // ----- NEW: seed Advanced from the item itself -----
                        channel: (openEdit as any).channel,
                        includeLocationIds: (openEdit as any).includeLocationIds,
                        excludeLocationIds: (openEdit as any).excludeLocationIds,

                        // IMPORTANT: derive excludeChannel from visibility if server didn't include it
                        excludeChannel:
                          (openEdit as any).excludeChannel ??
                          ((openEdit as any).visibility?.dineIn === false
                            ? 'dine-in'
                            : (openEdit as any).visibility?.online === false
                            ? 'online'
                            : undefined),

                        excludeAtLocationIds: (openEdit as any).excludeAtLocationIds,
                        excludeChannelAt: (openEdit as any).excludeChannelAt,
                        excludeChannelAtLocationIds: (openEdit as any).excludeChannelAtLocationIds,
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

                        // (Optional) also update Advanced on edit
                        if (values.channel) payload.channel = values.channel;
                        if (values.includeLocationIds?.length) payload.includeLocationIds = values.includeLocationIds;
                        if (values.excludeLocationIds?.length) payload.excludeLocationIds = values.excludeLocationIds;

                        if (values.excludeChannel) (payload as any).excludeChannel = values.excludeChannel;
                        if (values.excludeAtLocationIds?.length)
                          (payload as any).excludeAtLocationIds = values.excludeAtLocationIds;
                        if (values.excludeChannelAt) (payload as any).excludeChannelAt = values.excludeChannelAt;
                        if (values.excludeChannelAtLocationIds?.length)
                          (payload as any).excludeChannelAtLocationIds = values.excludeChannelAtLocationIds;

                        await updateMut.mutateAsync({ id: editingId, payload });
                        setQueuedHighlightId(editingId);
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Single delete dialog */}
                {openDeleteOne && canDelete && (
                  <ConfirmDeleteItemsDialog
                    open={openDeleteOne}
                    count={1}
                    scope={isBranchView ? 'branch' : 'global'}
                    onClose={() => {
                      setOpenDeleteOne(false);
                      setDeleteOneId(null);
                    }}
                    onConfirm={async () => {
                      if (!deleteOneId) return;
                      await deleteMut.mutateAsync({ id: deleteOneId });
                      setOpenDeleteOne(false);
                      setDeleteOneId(null);
                    }}
                    isSubmitting={deleteMut.isPending}
                  />
                )}

                {/* Bulk delete dialog */}
                {openDeleteMany && canDelete && (
                  <ConfirmDeleteItemsDialog
                    open={openDeleteMany}
                    count={selectedIds.size}
                    scope={isBranchView ? 'branch' : 'global'}
                    onClose={() => setOpenDeleteMany(false)}
                    onConfirm={() => {
                      const raw = Array.from(selectedIds);
                      if (!raw.length) {
                        setOpenDeleteMany(false);
                        return;
                      }

                      if (isBranchView) {
                        // Branch scope: remove from this location only
                        bulkAvailabilityMut.mutate(
                          { ids: raw, active: false },
                          {
                            onSettled: () => {
                              setOpenDeleteMany(false);
                              clearSelection();
                            },
                          }
                        );
                      } else {
                        // All locations: true delete everywhere (ensure 24-hex ObjectIds)
                        const byId = new Map(viewItems.map((it: any) => [it.id, it]));
                        const HEX24 = /^[a-fA-F0-9]{24}$/;
                        const ids = raw
                          .map((sid) => {
                            const it: any = byId.get(sid);
                            const candidates = [it?.id, it?._id, it?.itemId];
                            return candidates?.find((v: unknown) => typeof v === 'string' && HEX24.test(v as string));
                          })
                          .filter(Boolean) as string[];

                        if (!ids.length) {
                          setOpenDeleteMany(false);
                          clearSelection();
                          return;
                        }

                        bulkDeleteMut.mutate(
                          { ids },
                          {
                            onSettled: () => {
                              setOpenDeleteMany(false);
                              clearSelection();
                            },
                          }
                        );
                      }
                    }}
                    isSubmitting={isBranchView ? bulkAvailabilityMut.isPending : bulkDeleteMut.isPending}
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
