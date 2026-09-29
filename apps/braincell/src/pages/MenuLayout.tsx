/**
 * MenuLayout.tsx
 *
 * Controls how customers see the menu:
 *   - drag & drop order of categories, and of items inside each category
 *   - menu-wide notes shown at the bottom of the storefront menu
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeftIcon, Bars3Icon, ChevronDownIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { useTenant } from '../hooks/useTenant';
import { getCategories, reorderCategories, type Category } from '../api/categories';
import { getMenuItems, reorderMenuItems, type MenuItem } from '../api/menuItems';
import { updateTenant } from '../api/tenant';
import { toastError, toastSuccess } from '../components/Toaster';
import Can from '../components/Can';

function broadcastMenuChanged() {
  try {
    window.dispatchEvent(new CustomEvent('categories:updated'));
    window.dispatchEvent(new CustomEvent('menu:updated'));
    localStorage.setItem('categories:updated', String(Date.now()));
    localStorage.setItem('menu:updated', String(Date.now()));
  } catch {}
}

const bySortOrder = <T extends { sortOrder?: number; name: string }>(a: T, b: T) =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name);

/* ------------------------------ Sortable rows ------------------------------ */

function DragHandle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      className="cursor-grab touch-none rounded p-1 text-[#9a9aa0] hover:bg-[#f0f0f0] hover:text-[#2e2e30] active:cursor-grabbing"
      {...props}
    >
      <Bars3Icon className="h-5 w-5" />
    </button>
  );
}

function SortableItemRow({ item }: { item: MenuItem }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-t border-[#f0f0f0] bg-white px-4 py-2 ${
        isDragging ? 'relative z-10 shadow-md' : ''
      }`}
    >
      <DragHandle {...attributes} {...listeners} />
      {item.media?.[0] ? (
        <img src={item.media[0]} alt="" className="h-9 w-9 rounded-md object-cover" />
      ) : (
        <div className="h-9 w-9 rounded-md bg-[#f3f3f3]" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-[#2e2e30]">{item.name}</span>
      {item.status === 'hidden' && <span className="text-xs text-[#9a9aa0]">Hidden</span>}
    </li>
  );
}

function SortableCategory({
  category,
  items,
  open,
  onToggle,
  onItemsReordered,
}: {
  category: Category;
  items: MenuItem[];
  open: boolean;
  onToggle: () => void;
  onItemsReordered: (next: MenuItem[]) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: category.id,
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onItemsReordered(arrayMove(items, from, to));
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-xl border border-[#e5e5e5] bg-white ${isDragging ? 'relative z-20 shadow-lg' : 'shadow-sm'}`}
    >
      <div className="flex items-center gap-2 bg-[#fcfcfc] px-3 py-2.5">
        <DragHandle {...attributes} {...listeners} />
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="truncate font-medium text-[#2e2e30]">{category.name}</span>
          <span className="text-xs text-[#6b6b70]">{items.length} items</span>
          <ChevronDownIcon
            className={`ml-auto h-4 w-4 text-[#6b6b70] transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      {open &&
        (items.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul>
                {items.map((item) => (
                  <SortableItemRow key={item.id} item={item} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="border-t border-[#f0f0f0] px-4 py-3 text-sm text-[#9a9aa0]">No items in this category.</p>
        ))}
    </li>
  );
}

/* ------------------------------- Menu notes -------------------------------- */

type NotesField = 'menuNotes' | 'waiterKnowledge';

function NotesListCard({
  field,
  title,
  description,
  placeholder,
  addLabel,
  maxItems,
  maxLength,
}: {
  field: NotesField;
  title: string;
  description: ReactNode;
  placeholder: string;
  addLabel: string;
  maxItems: number;
  maxLength: number;
}) {
  const { token } = useAuthContext();
  const { data: tenant } = useTenant();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = tenant?.[field] ?? [];

  useEffect(() => {
    setNotes(tenant?.[field] ?? []);
  }, [tenant, field]);

  const cleaned = notes.map((n) => n.trim()).filter(Boolean);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ [field]: cleaned }, token as string);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess(`${title} saved`);
    } catch (err: any) {
      toastError(err?.response?.data?.message || `Could not save ${title.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-[#2e2e30]">{title}</h3>
      <p className="mt-1 text-sm text-[#6b6b70]">{description}</p>
      <div className="mt-4 space-y-2">
        {notes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={n}
              maxLength={maxLength}
              onChange={(e) => setNotes(notes.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={placeholder}
              className="min-w-0 flex-1 rounded-md border border-[#dbdbdb] px-3 py-2 text-sm outline-none focus:border-[#2e2e30]"
            />
            <button
              type="button"
              aria-label="Remove note"
              onClick={() => setNotes(notes.filter((_, j) => j !== i))}
              className="rounded p-1.5 text-[#9a9aa0] hover:text-red-600"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
        {notes.length < maxItems && (
          <button
            type="button"
            onClick={() => setNotes([...notes, ''])}
            className="inline-flex items-center gap-1 text-sm text-[#6b6b70] hover:text-[#2e2e30]"
          >
            <PlusIcon className="h-4 w-4" /> {addLabel}
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

function MenuNotesCard() {
  return (
    <NotesListCard
      field="menuNotes"
      title="Menu notes"
      description="Shown at the bottom of your menu — e.g. “All prices include VAT”, “V = Vegetarian”, “Please tell us about allergies”."
      placeholder="Note"
      addLabel="Add note"
      maxItems={20}
      maxLength={300}
    />
  );
}

function WaiterKnowledgeCard() {
  return (
    <NotesListCard
      field="waiterKnowledge"
      title="Virtual waiter knowledge"
      description="Facts your virtual waiter can tell guests. It won't guess anything that isn't here — e.g. “Wi-Fi: BurgerHouse_Guest, password burger123”, “We accept cash, bKash and cards”, “All our meat is halal”, “Free parking behind the building”, “Washroom is next to the counter”."
      placeholder="e.g. We accept cash, bKash and all major cards"
      addLabel="Add fact"
      maxItems={40}
      maxLength={500}
    />
  );
}

/* ---------------------------------- Page ----------------------------------- */

export default function MenuLayoutPage() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();

  const catsQuery = useQuery({
    queryKey: ['categories', token, 'menu-layout'],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
  });
  const itemsQuery = useQuery({
    queryKey: ['menu-items', token, 'menu-layout'],
    queryFn: () => getMenuItems(token as string),
    enabled: !!token,
  });

  const [cats, setCats] = useState<Category[]>([]);
  const [itemsByCat, setItemsByCat] = useState<Record<string, MenuItem[]>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (catsQuery.data) setCats([...catsQuery.data].sort(bySortOrder));
  }, [catsQuery.data]);

  useEffect(() => {
    if (!itemsQuery.data) return;
    const grouped: Record<string, MenuItem[]> = {};
    for (const it of itemsQuery.data) {
      const key = it.categoryId || '';
      (grouped[key] ??= []).push(it);
    }
    for (const k of Object.keys(grouped)) grouped[k].sort(bySortOrder);
    setItemsByCat(grouped);
  }, [itemsQuery.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const afterSave = () => {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey as unknown[];
        return Array.isArray(k) && (k[0] === 'categories' || k[0] === 'menu-items') && k[2] !== 'menu-layout';
      },
    });
    broadcastMenuChanged();
  };

  const onCategoryDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = cats.findIndex((c) => c.id === active.id);
    const to = cats.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    const prev = cats;
    const next = arrayMove(cats, from, to);
    setCats(next);
    try {
      await reorderCategories(next.map((c) => c.id));
      afterSave();
    } catch (err: any) {
      setCats(prev);
      toastError(err?.response?.data?.message || 'Could not save the new order');
    }
  };

  const onItemsReordered = async (categoryId: string, next: MenuItem[]) => {
    const prev = itemsByCat[categoryId] ?? [];
    setItemsByCat((m) => ({ ...m, [categoryId]: next }));
    try {
      await reorderMenuItems(next.map((i) => i.id));
      afterSave();
    } catch (err: any) {
      setItemsByCat((m) => ({ ...m, [categoryId]: prev }));
      toastError(err?.response?.data?.message || 'Could not save the new order');
    }
  };

  const allOpen = useMemo(() => cats.length > 0 && cats.every((c) => openIds.has(c.id)), [cats, openIds]);
  const loading = catsQuery.isLoading || itemsQuery.isLoading;

  return (
    <div className="px-6 py-5">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/categories" className="rounded-md p-1.5 text-[#6b6b70] hover:bg-[#f0f0f0]" aria-label="Back">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-lg font-semibold text-[#2e2e30]">Menu layout</h2>
          <p className="text-sm text-[#6b6b70]">Drag categories and items into the order customers should see them.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-[#2e2e30]">Order</h3>
            {cats.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenIds(allOpen ? new Set() : new Set(cats.map((c) => c.id)))}
                className="text-sm text-[#6b6b70] underline-offset-2 hover:text-[#2e2e30] hover:underline"
              >
                {allOpen ? 'Collapse all' : 'Show items'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-[#f0f0f0]" />
              ))}
            </div>
          ) : !cats.length ? (
            <p className="rounded-xl border border-[#e5e5e5] bg-white p-6 text-sm text-[#6b6b70]">
              No categories yet. <Link to="/categories?new=1" className="underline">Add one</Link> or{' '}
              <Link to="/menu-import" className="underline">import a PDF menu</Link>.
            </p>
          ) : (
            <Can capability="categories:update" fallback={<p className="text-sm text-[#6b6b70]">You can’t change the menu order.</p>}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onCategoryDragEnd}>
                <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-2">
                    {cats.map((c) => (
                      <SortableCategory
                        key={c.id}
                        category={c}
                        items={itemsByCat[c.id] ?? []}
                        open={openIds.has(c.id)}
                        onToggle={() =>
                          setOpenIds((s) => {
                            const n = new Set(s);
                            if (n.has(c.id)) n.delete(c.id);
                            else n.add(c.id);
                            return n;
                          })
                        }
                        onItemsReordered={(next) => onItemsReordered(c.id, next)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </Can>
          )}
        </section>

        <aside>
          <Can capability="categories:update">
            <div className="space-y-4">
              <MenuNotesCard />
              <WaiterKnowledgeCard />
            </div>
          </Can>
        </aside>
      </div>
    </div>
  );
}
