import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  DragCancelEvent,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { ArrowsUpDownIcon, MagnifyingGlassIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useMenuItems } from '../components/MenuItems/useMenuItems';

type PanelSortBy = 'name-asc' | 'created-desc' | 'price-asc' | 'price-desc';

function ManageSkeleton() {
  return (
    <div className="p-6 text-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-6 w-48 rounded bg-slate-200 animate-pulse" />
        <div className="flex gap-2">
          <div className="h-9 w-40 rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
          <div className="h-9 w-24 rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-28 rounded-full bg-slate-200 animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[1, 2].map((col) => (
          <div key={col} className="rounded-lg border border-[#ececec] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="h-5 w-36 rounded bg-slate-200 animate-pulse" />
              <div className="h-9 w-64 rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
            </div>
            <div className="h-[592px] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-10 w-full rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SortMenu({ sortBy, setSortBy }: { sortBy: PanelSortBy; setSortBy: (v: PanelSortBy) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (open && ref.current && !ref.current.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 hover:bg-[#f5f5f5]"
      >
        <ArrowsUpDownIcon className="h-4 w-4 text-[#6b7280]" />
        {sortBy === 'name-asc' && 'Name (A–Z)'}
        {sortBy === 'created-desc' && 'Recently created'}
        {sortBy === 'price-asc' && 'Price (low→high)'}
        {sortBy === 'price-desc' && 'Price (high→low)'}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg">
          <ul className="py-1">
            {[
              { k: 'name-asc', l: 'Name (A–Z)' },
              { k: 'created-desc', l: 'Recently created' },
              { k: 'price-asc', l: 'Price (low→high)' },
              { k: 'price-desc', l: 'Price (high→low)' },
            ].map((o) => (
              <li key={o.k}>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy(o.k as PanelSortBy);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-[#f5f5f5] ${
                    sortBy === (o.k as PanelSortBy) ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {sortBy === (o.k as PanelSortBy) ? <CheckIcon className="h-4 w-4" /> : <span className="h-4 w-4" />}
                    {o.l}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DroppableChip({ id, label, isActive }: { id: string; label: string; isActive?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const activeClasses = isActive
    ? 'border-[#2e2e30] bg-[#2e2e30] text-white'
    : 'border-[#dbdbdb] bg-[#fcfcfc] text-[#2e2e30]';
  return (
    <div
      ref={setNodeRef}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm ${activeClasses} ${
        isOver ? 'ring-2 ring-[#2e2e30]' : ''
      }`}
    >
      {label}
    </div>
  );
}

function DroppablePanel({
  id,
  title,
  count,
  search,
  setSearch,
  sortBy,
  setSortBy,
  children,
}: {
  id: string;
  title: string;
  count: number;
  search: string;
  setSearch: (v: string) => void;
  sortBy: PanelSortBy;
  setSortBy: (v: PanelSortBy) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-[#ececec] bg-white p-4 overflow-hidden ${isOver ? 'ring-2 ring-[#2e2e30]' : ''}`}
    >
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <div className="font-medium text-[#111827]">{title}</div>
          <div className="rounded-full bg-[#f1f2f4] px-2 py-0.5 text-xs text-[#44464b]">{count}</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-[260px] items-center rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 focus-within:border-[#111827]">
            <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items"
              className="min-w-0 flex-1 bg-transparent placeholder-[#a9a9ab] focus:outline-none"
            />
            {search ? (
              <button aria-label="Clear" className="text-[#6b7280] hover:text-[#111827]" onClick={() => setSearch('')}>
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <SortMenu sortBy={sortBy} setSortBy={setSortBy} />
        </div>
      </div>

      <div className="space-y-2 h-[592px] overflow-y-auto overflow-x-hidden pr-1">{children}</div>
    </div>
  );
}

type DraggableItemProps = {
  id: string;
  name: string;
  price?: number;
  description?: string;
  onRemove?: () => void;
  ghost?: boolean;
  provideRef?: (el: HTMLElement | null) => void;
};

function DraggableItem({
  id,
  name,
  price,
  description,
  onRemove,
  ghost = false,
  provideRef,
}: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  const setRefs = (node: HTMLElement | null) => {
    setNodeRef(node);
    provideRef?.(node);
  };

  const style: React.CSSProperties = {
    cursor: isDragging ? 'grabbing' : 'grab',
    opacity: ghost ? 0.35 : isDragging ? 0.85 : 1,
    width: '100%',
    maxWidth: '100%',
  };
  if (!isDragging && transform) style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0)`;

  const letter = name?.trim()?.[0]?.toUpperCase() || '•';
  return (
    <div
      ref={setRefs}
      {...attributes}
      {...listeners}
      style={style}
      className={`select-none w-full max-w-full items-center gap-3 rounded-md border border-[#ececec] bg-white px-3 py-2 text-sm hover:bg-[#fafafa] ${
        isDragging ? 'shadow-md' : ''
      } flex`}
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#eef2ff] to-[#fdf2f8] text-xs font-semibold text-[#374151] ring-1 ring-[#ececec]">
        {letter}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[#111827]">{name}</div>
        {description ? <div className="truncate text-[12px] text-[#6b7280]">{description}</div> : null}
      </div>
      <div className="ml-2 flex items-center gap-2">
        <div className="text-[13px] font-medium text-[#111827] whitespace-nowrap">
          {price != null ? `$${Number(price).toFixed(2)}` : ''}
        </div>
        {onRemove && (
          <button
            type="button"
            title="Remove from category"
            aria-label="Remove from category"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded p-1 text-[#6b7280] hover:text-red-600"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function DragPreview({ name, price, description }: { name: string; price?: number; description?: string }) {
  const letter = name?.trim()?.[0]?.toUpperCase() || '•';
  return (
    <div className="pointer-events-none z-[10000] overflow-hidden whitespace-nowrap rounded-md border border-[#ececec] bg-white px-3 py-2 text-sm shadow-xl ring-1 ring-black/5 w-full">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#eef2ff] to-[#fdf2f8] text-xs font-semibold text-[#374151] ring-1 ring-[#ececec]">
          {letter}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[#111827]">{name}</div>
          {description ? <div className="truncate text-[12px] text-[#6b7280]">{description}</div> : null}
        </div>
        <div className="text-[13px] font-medium text-[#111827]">
          {price != null ? `$${Number(price).toFixed(2)}` : ''}
        </div>
      </div>
    </div>
  );
}

export default function ManageCategories(): JSX.Element {
  const { itemsQuery, categoriesQuery, items, categories, updateMut } = useMenuItems();

  // Staged assignments (save on button)
  const [assignments, setAssignments] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false); // SINGLE declaration

  // Selection + panel controls
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [poolQ, setPoolQ] = useState('');
  const [poolSort, setPoolSort] = useState<PanelSortBy>('name-asc');
  const [catQ, setCatQ] = useState('');
  const [catSort, setCatSort] = useState<PanelSortBy>('name-asc');

  // Drag overlay state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overlayWidth, setOverlayWidth] = useState<number | undefined>(undefined);
  const itemNodes = useRef<Map<string, HTMLElement>>(new Map());

  // Router: requested category (query or state)
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedCategory = useMemo(() => {
    const fromQuery = (searchParams.get('c') || '').trim();
    const fromState =
      (location.state as any)?.selectedCategory
        ? String((location.state as any).selectedCategory).trim()
        : '';
    return (fromQuery || fromState).toLowerCase();
  }, [searchParams, location.state]);

  // Track last applied requested category, so we only apply each value once
  const lastAppliedRequested = useRef<string | null>(null);

  // Apply ?c=... only as an entrypoint (once per value), otherwise keep user's choice
  useEffect(() => {
    if (!categories.length) return;

    const req = requestedCategory || '';

    // Apply requested category if we haven't applied this value yet
    if (req && lastAppliedRequested.current !== req) {
      const match = categories.find((c) => c.name.toLowerCase() === req);
      if (match) {
        setSelectedCategory(match.name);
        lastAppliedRequested.current = req;
        return;
      }
    }

    // Ensure current selection is valid or fall back to first category
    setSelectedCategory((prev) => {
      if (prev && categories.some((c) => c.name === prev)) return prev;
      return categories[0]?.name ?? '';
    });
  }, [categories, requestedCategory]);

  // Initialize staged map from server data
  useEffect(() => {
    const map: Record<string, string | undefined> = {};
    for (const it of items) map[it.id] = it.category || undefined;
    setAssignments(map);
  }, [items]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const normalize = (s: string) => s.trim().toLowerCase();
  const sortItems = (list: any[], sortBy: PanelSortBy) => {
    if (sortBy === 'name-asc') return list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc')
      return list.slice().sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    if (sortBy === 'price-asc') return list.slice().sort((a: any, b: any) => (a.price ?? 0) - (b.price ?? 0));
    if (sortBy === 'price-desc') return list.slice().sort((a: any, b: any) => (b.price ?? 0) - (a.price ?? 0));
    return list;
  };

  const setAssignment = useCallback((id: string, cat?: string) => {
    setAssignments((prev) => ({ ...prev, [id]: cat }));
  }, []);

  // Derived lists from staged state
  const poolItems = useMemo(() => {
    const q = normalize(poolQ);
    let list = items.filter((it: any) => assignments[it.id] !== selectedCategory);
    if (q) {
      list = list.filter(
        (it: any) =>
          it.name.toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q) ||
          (assignments[it.id] || '').toLowerCase().includes(q)
      );
    }
    return sortItems(list, poolSort);
  }, [items, assignments, selectedCategory, poolQ, poolSort]);

  const catItems = useMemo(() => {
    if (!selectedCategory) return [];
    const q = normalize(catQ);
    let list = items.filter((it: any) => assignments[it.id] === selectedCategory);
    if (q) {
      list = list.filter(
        (it: any) =>
          it.name.toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q)
      );
    }
    return sortItems(list, catSort);
  }, [items, assignments, selectedCategory, catQ, catSort]);

  const countsByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of categories) m.set(c.name, 0);
    for (const it of items) {
      const a = assignments[it.id];
      if (!a) continue;
      m.set(a, (m.get(a) ?? 0) + 1);
    }
    return m;
  }, [items, categories, assignments]);

  // DnD staging only
  const handleDragStart = useCallback((e: DragStartEvent) => {
    const id = e.active.id as string;
    setActiveId(id);
    const node = itemNodes.current.get(id);
    setOverlayWidth(node ? node.getBoundingClientRect().width : undefined);
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const overId = e.over?.id as string | undefined;
      const id = e.active.id as string;
      setActiveId(null);
      setOverlayWidth(undefined);
      if (!overId) return;

      if (overId.startsWith('chip:')) {
        const targetName = overId.slice(5);
        setAssignment(id, targetName);
        return;
      }
      if (overId === 'panel:pool') {
        setAssignment(id, undefined);
        return;
      }
      if (overId === 'panel:category' && selectedCategory) {
        setAssignment(id, selectedCategory);
        return;
      }
    },
    [setAssignment, selectedCategory]
  );

  const handleDragCancel = useCallback((_: DragCancelEvent) => {
    setActiveId(null);
    setOverlayWidth(undefined);
  }, []);

  // Save staged diffs
  const original = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const it of items) m.set(it.id, it.category || undefined);
    return m;
  }, [items]);

  const changedItems = useMemo(() => {
    const diffs: Array<{ id: string; category?: string }> = [];
    for (const it of items) {
      const staged = assignments[it.id];
      const orig = original.get(it.id);
      if (staged !== orig) diffs.push({ id: it.id, category: staged });
    }
    return diffs;
  }, [items, assignments, original]);

  const saveChanges = async () => {
    if (saving || changedItems.length === 0) return;
    setSaving(true);
    try {
      await Promise.allSettled(
        changedItems.map(({ id, category }) => updateMut.mutateAsync({ id, payload: { category } }))
      );
    } finally {
      setSaving(false);
    }
  };

  const loading = itemsQuery.isLoading || categoriesQuery.isLoading;

  const activeItem = useMemo(
    () => (activeId ? items.find((it) => it.id === activeId) : undefined),
    [activeId, items]
  );

  const registerNode = (id: string) => (el: HTMLElement | null) => {
    if (el) itemNodes.current.set(id, el);
    else itemNodes.current.delete(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Manage Categories</h2>
        <div className="flex items-center gap-2">
          <Link
            to="/categories"
            className="rounded-md border border-[#cecece] px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
          >
            Back to Categories
          </Link>
          <button
            type="button"
            onClick={saveChanges}
            disabled={saving || changedItems.length === 0}
            className={`rounded-md px-4 py-2 text-sm text-white ${
              saving || changedItems.length === 0 ? 'bg-[#9aa0a6] cursor-not-allowed' : 'bg-[#2e2e30] hover:opacity-90'
            }`}
            title={changedItems.length === 0 ? 'No changes to save' : 'Save changes'}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {loading ? (
        <ManageSkeleton />
      ) : itemsQuery.isError ? (
        <div className="p-6 text-red-600">Failed to load data.</div>
      ) : (
        <div className="p-6 text-sm">
          {/* Chips row */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                className="group"
                type="button"
                onClick={() => setSelectedCategory(c.name)}
              >
                <DroppableChip
                  id={`chip:${c.name}`}
                  label={`${c.name} (${(countsByCategory.get(c.name) ?? 0)})`}
                  isActive={selectedCategory === c.name}
                />
              </button>
            ))}
            {categories.length === 0 && (
              <div className="text-[#6b7280]">No categories yet. Create one to start managing.</div>
            )}
          </div>

          <DndContext
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            sensors={sensors}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DroppablePanel
                id="panel:pool"
                title="Items Pool"
                count={poolItems.length}
                search={poolQ}
                setSearch={setPoolQ}
                sortBy={poolSort}
                setSortBy={setPoolSort}
              >
                {poolItems.map((it: any) => (
                  <DraggableItem
                    key={it.id}
                    id={it.id}
                    name={it.name}
                    price={it.price}
                    description={it.description}
                    ghost={activeId === it.id}
                    provideRef={registerNode(it.id)}
                  />
                ))}
                {poolItems.length === 0 && (
                  <div className="rounded border border-dashed border-[#e4e4e7] p-4 text-center text-[#6b7280]">
                    No items. Adjust search or sort.
                  </div>
                )}
              </DroppablePanel>

              <DroppablePanel
                id="panel:category"
                title={selectedCategory ? `Category: ${selectedCategory}` : 'Select a category'}
                count={catItems.length}
                search={catQ}
                setSearch={setCatQ}
                sortBy={catSort}
                setSortBy={setCatSort}
              >
                {catItems.map((it: any) => (
                  <DraggableItem
                    key={it.id}
                    id={it.id}
                    name={it.name}
                    price={it.price}
                    description={it.description}
                    onRemove={() => setAssignment(it.id, undefined)}
                    ghost={activeId === it.id}
                    provideRef={registerNode(it.id)}
                  />
                ))}
                {catItems.length === 0 && selectedCategory && (
                  <div className="rounded border border-dashed border-[#e4e4e7] p-8 text-center text-[#6b7280]">
                    Drop items here to assign.
                  </div>
                )}
                {!selectedCategory && (
                  <div className="rounded border border-dashed border-[#e4e4e7] p-8 text-center text-[#6b7280]">
                    Pick a category to manage.
                  </div>
                )}
              </DroppablePanel>
            </div>

            {/* Overlay with measured width to match source row */}
            <DragOverlay dropAnimation={null}>
              {activeItem ? (
                <div style={{ zIndex: 10000, position: 'relative', width: overlayWidth }}>
                  <DragPreview
                    name={activeItem.name}
                    price={(activeItem as any).price}
                    description={activeItem.description}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  );
}