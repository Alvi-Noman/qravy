import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PlusCircleIcon,
  XMarkIcon,
  PhotoIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type VariantValue = {
  id: string;
  label: string;
  price?: string;
  imageFile?: File | null;
  imagePreview?: string | null;
};
export type VariationGroup = { id: string; values: VariantValue[]; editing: boolean };

type VariationsValue = { label: string; price?: string; imagePreview?: string | null };

export default function Variations({
  helpText = 'Add options like Size, Spice Level, or Toppings',
  value,
  onChange,
}: {
  helpText?: string;
  value?: VariationsValue[];
  onChange?: (rows: VariationsValue[]) => void;
}) {
  const [group, setGroup] = useState<VariationGroup | null>(null);

  useEffect(() => {
    if (group || !value || value.length === 0) return;
    const values: VariantValue[] = value.map((v) => ({
      id: cryptoId(),
      label: v.label,
      price: v.price,
      imagePreview: v.imagePreview ?? null,
      imageFile: null,
    }));
    setGroup({ id: cryptoId(), editing: false, values: normalizeInputs(values) });
  }, [value, group]);

  const updateValues = (next: VariantValue[]) =>
    setGroup((g) => (g ? { ...g, values: normalizeInputs(next) } : g));

  const setValue = (index: number, patch: Partial<VariantValue>) => {
    if (!group) return;
    const next = [...group.values];
    const prev = next[index];
    if (patch.imagePreview && prev?.imagePreview && prev.imagePreview !== patch.imagePreview) {
      try {
        URL.revokeObjectURL(prev.imagePreview);
      } catch {}
    }
    next[index] = { ...prev, ...patch };
    updateValues(next);
  };

  const removeValue = (index: number) => {
    if (!group) return;
    const next = [...group.values];
    const v = next[index];
    if (v?.imagePreview) URL.revokeObjectURL(v.imagePreview);
    next.splice(index, 1);
    updateValues(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const typed = useMemo(
    () => (group?.values || []).filter((v) => v.label.trim() !== ''),
    [group?.values]
  );

  useEffect(() => {
    if (!onChange) return;
    const payload: VariationsValue[] = typed.map((r) => ({
      label: r.label,
      price: r.price,
      imagePreview: r.imagePreview ?? null,
    }));
    onChange(payload);
  }, [typed, onChange]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!group) return;
    const { active, over } = e;
    if (!active || !over || active.id === over.id) return;

    const values = group.values;
    const typedIds = values.filter((v) => v.label.trim() !== '').map((v) => v.id);

    const from = typedIds.indexOf(String(active.id));
    if (from < 0) return;

    let to = typedIds.indexOf(String(over.id));
    if (to < 0) to = typedIds.length - 1;

    const nextTypedIds = arrayMove(typedIds, from, to);
    const nextTyped = nextTypedIds.map((id) => values.find((v) => v.id === id)!);
    const blanks = values.filter((v) => v.label.trim() === '');

    updateValues([...nextTyped, ...blanks]);
  };

  const rows = typed;

  return (
    <div className="text-[#2e2e30]">
      <div className="flex items-center gap-2 mb-2">
        <span className="block text-sm font-medium text-[#2e2e30]">Variations</span>
        <span className="relative inline-flex items-center group cursor-pointer align-middle">
          <QuestionMarkCircleIcon className="h-4 w-4 text-[#6b7280] group-hover:text-[#374151]" />
          <HoverCard label={helpText} placement="right" />
        </span>
      </div>

      {!group ? (
        <button
          type="button"
          onClick={() => setGroup({ id: cryptoId(), editing: true, values: [{ id: cryptoId(), label: '' }] })}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#2e2e30] border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f6f6f6] transition-colors px-3 py-2 rounded-md"
        >
          <PlusCircleIcon className="h-5 w-5 text-[#2e2e30]" />
          Add Options
        </button>
      ) : (
        <div className="space-y-5">
          {group.editing ? (
            <div className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc]">
              <div className="p-3 space-y-2">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={group.values.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                    {group.values.map((v, idx) => {
                      const isBlank = v.label.trim() === '';
                      const canRemove = !(group.values.length === 1 && isBlank);
                      return (
                        <OptionRow
                          key={v.id}
                          item={v}
                          index={idx}
                          disabled={isBlank}
                          onLabelChange={(label) => setValue(idx, { label })}
                          onRemove={() => removeValue(idx)}
                          canRemove={canRemove}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>

                <div className="flex justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => setGroup(null)}
                    className="px-3 py-1.5 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#fff0f0] transition-colors text-sm text-red-600"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={rows.length === 0}
                    onClick={() =>
                      setGroup((g) => (g ? { ...g, editing: false, values: tidyValues(g.values) } : g))
                    }
                    className={`px-4 py-1.5 rounded-md text-sm text-white ${
                      rows.length === 0 ? 'bg-[#b0b0b5] cursor-not-allowed' : 'bg-[#111827] hover:opacity-90'
                    }`}
                  >
                    Done
                  </button>
                </div>
              </div>

              {rows.length > 0 && (
                <VariantTable
                  rows={rows}
                  onChange={(idx, patch) => {
                    const id = rows[idx].id;
                    const fullIndex = group.values.findIndex((v) => v.id === id);
                    if (fullIndex >= 0) setValue(fullIndex, patch);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc]">
              <div className="p-3">
                <div className="flex flex-wrap gap-2 mb-2">
                  {rows.length > 0 ? (
                    rows.map((v) => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full text-sm bg-[#EFEFEF] text-[#2e2e30]"
                      >
                        {v.label}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#a9a9ab]">No options</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setGroup((g) => (g ? { ...g, editing: true } : g))}
                  className="w-full flex items-center gap-2 text-sm font-medium text-[#2e2e30] border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f6f6f6] transition-colors rounded-md px-3 py-2"
                >
                  <PlusCircleIcon className="h-5 w-5 text-[#2e2e30]" />
                  <span>Add more options</span>
                </button>
              </div>

              {rows.length > 0 && (
                <VariantTable
                  rows={rows}
                  onChange={(idx, patch) => {
                    const id = rows[idx].id;
                    const fullIndex = group!.values.findIndex((v) => v.id === id);
                    if (fullIndex >= 0) setValue(fullIndex, patch);
                  }}
                  readOnlyLabels
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  item,
  index,
  disabled,
  onLabelChange,
  onRemove,
  canRemove,
}: {
  item: VariantValue;
  index: number;
  disabled: boolean;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  const handleProps = disabled ? {} : { ...attributes, ...listeners };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        className={`shrink-0 p-1.5 rounded-md ${
          disabled ? 'text-[#2e2e30] opacity-40 cursor-not-allowed' : 'text-[#2e2e30] cursor-grab active:cursor-grabbing'
        }`}
        aria-label={disabled ? 'Drag disabled' : 'Reorder option'}
        title={disabled ? '' : 'Drag to reorder'}
        {...handleProps}
      >
        <SixDotHandleIcon className="h-4 w-4" />
      </button>

      <input
        className="flex-1 border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors rounded-md px-3 py-2 bg-[#fcfcfc] text-sm text-[#2e2e30] placeholder-[#a9a9ab] focus:outline-none focus:ring-0"
        placeholder={`Option ${index + 1}`}
        value={item.label}
        onChange={(e) => onLabelChange((e.target as HTMLInputElement).value)}
      />

      {canRemove && (
        <button
          type="button"
          className="px-2 py-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#fff0f0] transition-colors text-sm text-red-600"
          onClick={onRemove}
          aria-label="Remove option"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function VariantTable({
  rows,
  onChange,
  readOnlyLabels,
}: {
  rows: VariantValue[];
  onChange: (index: number, patch: Partial<VariantValue>) => void;
  readOnlyLabels?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-[#dbdbdb] rounded-b-md overflow-x-auto">
      <div className="min-w-[480px]">
        <div className="grid grid-cols-[56px_1fr_180px] items-center px-3 py-2 bg-[#f6f6f6] border-b border-[#dbdbdb]">
          <div className="col-span-2 text-sm font-semibold text-[#2e2e30]">Variations</div>
          <div className="text-sm font-semibold text-[#2e2e30]">Price</div>
        </div>
        <div className="divide-y divide-[#dbdbdb]">
          {rows.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[56px_1fr_180px] items-center px-3 py-2 min-w-0 bg-[#fcfcfc]">
              <TinyImageBox
                preview={r.imagePreview || null}
                onPick={(file, url) => onChange(idx, { imageFile: file, imagePreview: url })}
                onClear={() => onChange(idx, { imageFile: null, imagePreview: null })}
              />
              <div className="text-sm text-[#2e2e30] truncate">{readOnlyLabels ? r.label : r.label}</div>
              <CurrencyCell value={r.price || ''} onChange={(v) => onChange(idx, { price: v })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CurrencyCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-stretch">
      <span className="px-2 py-2 border border-[#dbdbdb] border-r-0 rounded-l-md bg-[#fcfcfc] text-sm text-[#6b7280] select-none">৳</span>
      <input
        className="w-full border border-[#dbdbdb] border-l-[#dbdbdb] hover:border-[#111827] hover:border-l-[#111827] focus:border-[#111827] focus:border-l-[#111827] transition-colors rounded-r-md px-3 py-2 text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 bg-[#fcfcfc] text-[#2e2e30]"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        inputMode="decimal"
      />
    </div>
  );
}

function TinyImageBox({
  preview,
  onPick,
  onClear,
}: {
  preview: string | null;
  onPick: (file: File, previewUrl: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center">
      <button
        type="button"
        className="h-9 w-9 rounded-md border border-dashed border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f3f4f6] transition-colors flex items-center justify-center overflow-hidden"
        onClick={() => inputRef.current?.click()}
        aria-label="Pick variant image"
      >
        {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <PhotoIcon className="h-5 w-5 text-[#6b7280]" />}
      </button>
      {preview && (
        <button type="button" className="ml-2 text-xs text-red-600 hover:underline" onClick={onClear}>
          Remove
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          onPick(file, url);
        }}
      />
    </div>
  );
}

function HoverCard({
  label,
  placement = 'right',
}: {
  label: string;
  placement?: 'bottom' | 'left' | 'right';
}) {
  const pos =
    placement === 'left'
      ? 'right-full mr-2 top-1/2 -translate-y-1/2'
      : placement === 'right'
      ? 'left-full ml-2 top-1/2 -translate-y-1/2'
      : 'left-0 top-full mt-1';
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute ${pos} z-50 w-80 max-w-[22rem] rounded-md border border-[#dbdbdb] bg-[#fcfcfc] text-[#2e2e30] text-xs px-3 py-2 shadow-md opacity-0 translate-y-0 group-hover:opacity-100 group-hover:translate-y-[2px] transition duration-150 ease-out`}
    >
      {label}
    </span>
  );
}

function SixDotHandleIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} aria-hidden="true">
      <circle cx="4" cy="3" r="1.2" fill="currentColor" />
      <circle cx="10" cy="3" r="1.2" fill="currentColor" />
      <circle cx="4" cy="7" r="1.2" fill="currentColor" />
      <circle cx="10" cy="7" r="1.2" fill="currentColor" />
      <circle cx="4" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10" cy="11" r="1.2" fill="currentColor" />
    </svg>
  );
}

function tidyValues(values: VariantValue[]): VariantValue[] {
  return values.filter((v) => v.label.trim() !== '');
}
function normalizeInputs(values: VariantValue[]): VariantValue[] {
  const next = [...values];
  if (next.length === 0) next.push({ id: cryptoId(), label: '' });
  let i = next.length - 1;
  while (i > 0 && next[i].label.trim() === '' && next[i - 1].label.trim() === '') {
    const removed = next.pop();
    if (removed?.imagePreview) URL.revokeObjectURL(removed.imagePreview);
    i--;
  }
  if (next[next.length - 1].label.trim() !== '') next.push({ id: cryptoId(), label: '' });
  return next;
}
function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}