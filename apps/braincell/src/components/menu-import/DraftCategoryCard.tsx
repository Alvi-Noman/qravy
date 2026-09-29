import { useEffect, useState } from 'react';
import { ChevronDownIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { DraftCategory, DraftItem } from '../../api/menuImports';
import DraftItemRow from './DraftItemRow';
import { blankItem, itemNeedsAttention } from './draftUtils';
import HoursEditor, { validateHours } from '../Categories/HoursEditor';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function hoursSummary(windows: NonNullable<DraftCategory['availability']>): string {
  return windows
    .map((w) => `${w.days.length === 7 ? 'Every day' : w.days.map((d) => DAY[d]).join(', ')} ${w.start}–${w.end}`)
    .join(' · ');
}

export type ExistingCategoryOption = { id: string; name: string };

export default function DraftCategoryCard({
  category,
  currency,
  existingCategories,
  otherCategories,
  filter,
  onChange,
  onRemove,
  onMoveItem,
  onEditItem,
}: {
  category: DraftCategory;
  currency?: string;
  existingCategories: ExistingCategoryOption[];
  otherCategories: Array<{ tempId: string; name: string }>;
  filter: 'all' | 'attention' | 'duplicates';
  onChange: (next: DraftCategory) => void;
  onRemove: () => void;
  onMoveItem: (itemTempId: string, toCategoryTempId: string) => void;
  onEditItem: (item: DraftItem) => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(category.name);
  useEffect(() => setName(category.name), [category.name]);
  const [description, setDescription] = useState(category.description ?? '');
  useEffect(() => setDescription(category.description ?? ''), [category.description]);
  const [editingHours, setEditingHours] = useState(false);
  const hours = category.availability ?? [];
  const hoursError = validateHours(hours);

  const included = category.items.filter((i) => i.action !== 'skip').length;
  const allSkipped = included === 0;
  const matched = existingCategories.find((c) => c.id === category.matchCategoryId);

  const visibleItems = category.items.filter((i) =>
    filter === 'attention' ? itemNeedsAttention(i) : filter === 'duplicates' ? !!i.duplicateOfItemId : true
  );
  if (filter !== 'all' && !visibleItems.length) return null;

  const updateItem = (next: DraftItem) =>
    onChange({ ...category, items: category.items.map((i) => (i.tempId === next.tempId ? next : i)) });

  const setAllIncluded = (include: boolean) =>
    onChange({
      ...category,
      items: category.items.map((i) => ({
        ...i,
        // duplicates keep their own choice; everything else follows the toggle
        action: !include ? 'skip' : i.duplicateOfItemId ? i.action : 'create',
      })),
    });

  return (
    <section className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 bg-[#fcfcfc] px-4 py-3">
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen((v) => !v)}
          className="rounded p-1 text-[#6b6b70] hover:bg-[#f0f0f0]"
        >
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>

        <input
          aria-label="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) return setName(category.name);
            if (trimmed !== category.name) onChange({ ...category, name: trimmed });
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-[#2e2e30] outline-none hover:border-[#dbdbdb] focus:border-[#2e2e30] focus:bg-white"
        />

        <span className="text-xs text-[#6b6b70]">
          {included}/{category.items.length} items
        </span>

        <select
          aria-label="Category destination"
          value={category.matchCategoryId ?? ''}
          onChange={(e) => onChange({ ...category, matchCategoryId: e.target.value || null })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            matched ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <option value="">New category</option>
          {existingCategories.map((c) => (
            <option key={c.id} value={c.id}>
              Merge into “{c.name}”
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setAllIncluded(allSkipped)}
          className="rounded-md border border-[#dbdbdb] px-2 py-1 text-xs text-[#2e2e30] hover:bg-[#f6f6f6]"
        >
          {allSkipped ? 'Include all' : 'Skip all'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove category from import"
          className="rounded-md border border-[#dbdbdb] p-1.5 text-[#6b6b70] hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </header>

      {open && (
        <div className="space-y-2 border-t border-[#f0f0f0] px-4 py-3">
          <input
            aria-label="Category description"
            value={description}
            maxLength={500}
            placeholder="Section description (optional), e.g. “All curries served with rice”"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description.trim() !== (category.description ?? '') &&
              onChange({ ...category, description: description.trim() || undefined })
            }
            className="w-full rounded-md border border-transparent px-2 py-1 text-sm text-[#6b6b70] outline-none hover:border-[#dbdbdb] focus:border-[#2e2e30] focus:text-[#2e2e30]"
          />
          <div className="flex flex-wrap items-center gap-2 px-2 text-xs">
            {hours.length > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                Served {hoursSummary(hours)}
              </span>
            ) : (
              <span className="text-[#9a9aa0]">Available all day</span>
            )}
            <button
              type="button"
              onClick={() => setEditingHours((v) => !v)}
              className="text-[#6b6b70] underline-offset-2 hover:text-[#2e2e30] hover:underline"
            >
              {editingHours ? 'Done' : 'Edit hours'}
            </button>
          </div>
          {editingHours && (
            <div className="px-2">
              <HoursEditor
                value={hours}
                onChange={(next) => onChange({ ...category, availability: next })}
                error={hoursError}
              />
            </div>
          )}
        </div>
      )}

      {open && (
        <div>
          {visibleItems.map((item) => (
            <DraftItemRow
              key={item.tempId}
              item={item}
              currency={currency}
              moveTargets={otherCategories}
              onChange={updateItem}
              onMove={(to) => onMoveItem(item.tempId, to)}
              onRemove={() =>
                onChange({ ...category, items: category.items.filter((i) => i.tempId !== item.tempId) })
              }
              onEdit={() => onEditItem(item)}
            />
          ))}
          {filter === 'all' && (
            <button
              type="button"
              onClick={() => onEditItem(blankItem())}
              className="flex w-full items-center gap-2 border-t border-[#f0f0f0] px-4 py-2.5 text-sm text-[#6b6b70] hover:bg-[#fafafa] hover:text-[#2e2e30]"
            >
              <PlusIcon className="h-4 w-4" /> Add item
            </button>
          )}
        </div>
      )}
    </section>
  );
}
