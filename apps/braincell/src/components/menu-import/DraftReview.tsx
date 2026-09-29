import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import {
  saveMenuImportDraft,
  importErrorMessage,
  type DraftCategory,
  type DraftItem,
  type DraftMenu,
  type MenuImport,
} from '../../api/menuImports';
import { getCategories } from '../../api/categories';
import { useAuthContext } from '../../context/AuthContext';
import DraftCategoryCard, { type ExistingCategoryOption } from './DraftCategoryCard';
import {
  applyModalValues,
  draftHasInvalidHours,
  draftStats,
  toModalInitial,
  type ModalValues,
} from './draftUtils';

const MenuItemModal = lazy(() => import('../menu-item-modal/MenuItemModal'));

const AUTOSAVE_MS = 1200;

type Filter = 'all' | 'attention' | 'duplicates';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function DraftReview({
  job,
  committing,
  onCommit,
  onStartOver,
}: {
  job: MenuImport;
  committing: boolean;
  onCommit: (draft: DraftMenu) => void;
  onStartOver: () => void;
}) {
  const { token } = useAuthContext();
  const [draft, setDraft] = useState<DraftMenu>(() => job.draft ?? { categories: [] });
  const [filter, setFilter] = useState<Filter>('all');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [editing, setEditing] = useState<{ catTempId: string; item: DraftItem } | null>(null);

  const { data: existing = [] } = useQuery({
    queryKey: ['categories', token, 'menu-import'],
    queryFn: () => getCategories(token as string),
    enabled: !!token,
    staleTime: 60_000,
  });
  const existingCategories: ExistingCategoryOption[] = useMemo(
    () =>
      (existing as Array<{ id?: string; _id?: string; name: string }>)
        .map((c) => ({ id: String(c.id ?? c._id), name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [existing]
  );

  /* ------------------------------- autosave -------------------------------- */
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(draft);
  latest.current = draft;

  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      await saveMenuImportDraft(job.id, latest.current);
      setSaveState('saved');
    } catch (err) {
      dirty.current = true;
      setSaveState('error');
      console.warn('menu import autosave failed:', importErrorMessage(err));
    }
  }, [job.id]);

  const update = useCallback(
    (fn: (d: DraftMenu) => DraftMenu) => {
      setDraft((d) => fn(d));
      dirty.current = true;
      setSaveState('idle');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  /* ------------------------------- mutations ------------------------------- */
  const setCategory = (next: DraftCategory) =>
    update((d) => ({ ...d, categories: d.categories.map((c) => (c.tempId === next.tempId ? next : c)) }));

  const removeCategory = (tempId: string) =>
    update((d) => ({ ...d, categories: d.categories.filter((c) => c.tempId !== tempId) }));

  const moveItem = (fromCat: string, itemTempId: string, toCat: string) =>
    update((d) => {
      const item = d.categories.find((c) => c.tempId === fromCat)?.items.find((i) => i.tempId === itemTempId);
      if (!item) return d;
      // A duplicate match only holds within its original category
      const moved: DraftItem = item.duplicateOfItemId
        ? { ...item, duplicateOfItemId: null, action: 'create' }
        : item;
      return {
        ...d,
        categories: d.categories.map((c) =>
          c.tempId === fromCat
            ? { ...c, items: c.items.filter((i) => i.tempId !== itemTempId) }
            : c.tempId === toCat
              ? { ...c, items: [...c.items, moved] }
              : c
        ),
      };
    });

  /** Insert or replace an item after editing it in MenuItemModal. */
  const saveEditedItem = (catTempId: string, item: DraftItem) =>
    update((d) => ({
      ...d,
      categories: d.categories.map((c) => {
        if (c.tempId !== catTempId) return c;
        const exists = c.items.some((i) => i.tempId === item.tempId);
        return {
          ...c,
          items: exists ? c.items.map((i) => (i.tempId === item.tempId ? item : i)) : [...c.items, item],
        };
      }),
    }));

  const stats = useMemo(() => draftStats(draft), [draft]);
  const badHours = useMemo(() => draftHasInvalidHours(draft), [draft]);
  const editingCategory = editing && draft.categories.find((c) => c.tempId === editing.catTempId);

  return (
    <div className="pb-28">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#2e2e30]">Review your menu</h3>
          <p className="text-sm text-[#6b6b70]">
            We read <span className="font-medium">{job.fileName}</span> ({job.pageCount}{' '}
            {job.sourceType === 'photos' ? 'photo' : 'page'}
            {job.pageCount === 1 ? '' : 's'}). Check names and prices, fix anything marked, then import.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#6b6b70]">
          {saveState === 'saving' && <span>Saving…</span>}
          {saveState === 'saved' && <span>Draft saved</span>}
          {saveState === 'error' && <span className="text-red-600">Couldn’t save draft</span>}
          <button type="button" onClick={onStartOver} className="underline hover:text-[#2e2e30]">
            Upload a different file
          </button>
        </div>
      </div>

      {job.warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {job.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-none" /> {w}
            </p>
          ))}
        </div>
      )}

      {(draft.notes?.length ?? 0) > 0 && (
        <section className="mb-4 rounded-xl border border-[#e5e5e5] bg-white p-4">
          <h4 className="text-sm font-semibold text-[#2e2e30]">Menu notes found</h4>
          <p className="mb-2 text-xs text-[#6b6b70]">
            Added to your menu notes (shown at the bottom of your menu). Edit or remove any you don’t want.
          </p>
          <div className="space-y-1.5">
            {(draft.notes ?? []).map((note, i) => (
              <div key={`${i}:${note}`} className="flex items-center gap-2">
                <input
                  aria-label="Menu note"
                  defaultValue={note}
                  maxLength={300}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v === note) return;
                    update((d) => ({
                      ...d,
                      notes: (d.notes ?? []).map((x, j) => (j === i ? v : x)).filter(Boolean),
                    }));
                  }}
                  className="min-w-0 flex-1 rounded-md border border-[#dbdbdb] px-2 py-1.5 text-sm outline-none focus:border-[#2e2e30]"
                />
                <button
                  type="button"
                  aria-label="Remove note"
                  onClick={() => update((d) => ({ ...d, notes: (d.notes ?? []).filter((_, j) => j !== i) }))}
                  className="rounded px-2 py-1 text-xs text-[#6b6b70] hover:bg-red-50 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['all', `All items (${stats.items})`],
            ['attention', `Needs attention (${stats.attention})`],
            ['duplicates', `Already in menu (${stats.duplicates})`],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              filter === key
                ? 'border-[#2e2e30] bg-[#2e2e30] text-white'
                : 'border-[#dbdbdb] bg-white text-[#2e2e30] hover:bg-[#f6f6f6]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {draft.categories.map((cat) => (
          <DraftCategoryCard
            key={cat.tempId}
            category={cat}
            currency={draft.currency}
            existingCategories={existingCategories}
            otherCategories={draft.categories
              .filter((c) => c.tempId !== cat.tempId)
              .map((c) => ({ tempId: c.tempId, name: c.name }))}
            filter={filter}
            onChange={setCategory}
            onRemove={() => removeCategory(cat.tempId)}
            onMoveItem={(itemTempId, to) => moveItem(cat.tempId, itemTempId, to)}
            onEditItem={(item) => setEditing({ catTempId: cat.tempId, item })}
          />
        ))}
        {filter !== 'all' && stats[filter === 'attention' ? 'attention' : 'duplicates'] === 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-[#e5e5e5] bg-white p-6 text-sm text-[#6b6b70]">
            <CheckCircleIcon className="h-5 w-5 text-emerald-600" /> Nothing here.
          </div>
        )}
      </div>

      {/* sticky summary / import bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e5e5e5] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <p className="text-sm text-[#2e2e30]">
            <span className="font-semibold">{stats.categories}</span> categories
            {stats.merged > 0 && <span className="text-[#6b6b70]"> ({stats.merged} merged)</span>} ·{' '}
            <span className="font-semibold">{stats.included}</span> items
            {stats.updates > 0 && <span className="text-[#6b6b70]"> ({stats.updates} updates)</span>}
            {stats.skipped > 0 && <span className="text-[#6b6b70]"> · {stats.skipped} skipped</span>}
            {stats.blocking > 0 && (
              <span className="text-red-600"> · {stats.blocking} need a fix before importing</span>
            )}
            {badHours && <span className="text-red-600"> · fix the serving hours</span>}
          </p>
          <button
            type="button"
            disabled={committing || stats.included === 0 || stats.blocking > 0 || badHours}
            onClick={() => {
              clearTimeout(timer.current);
              dirty.current = false;
              onCommit(latest.current);
            }}
            className="rounded-md bg-[#2e2e30] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {committing ? 'Importing…' : `Import ${stats.included} item${stats.included === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {editing && editingCategory && (
        <Suspense fallback={null}>
          <MenuItemModal
            key={editing.item.tempId}
            title={editing.item.name ? 'Edit imported item' : 'Add item'}
            categories={draft.categories.map((c) => c.name)}
            initial={toModalInitial(editing.item, editingCategory)}
            onClose={() => setEditing(null)}
            onSubmit={(values: ModalValues) => {
              saveEditedItem(editing.catTempId, applyModalValues(editing.item, values));
              setEditing(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
