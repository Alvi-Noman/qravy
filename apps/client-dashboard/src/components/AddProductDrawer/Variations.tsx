import { useEffect, useMemo, useRef, useState } from 'react';
import { PlusCircleIcon, XMarkIcon, PhotoIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

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
  imageUrl?: string | null;
};
export type VariationGroup = { id: string; values: VariantValue[]; editing: boolean };

type VariationsValue = {
  label: string;
  price?: string;
  imagePreview?: string | null;
  imageUrl?: string | null;
};

const safeRevoke = (url?: string | null) => {
  if (!url || !url.startsWith('blob:')) return;
  requestAnimationFrame(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
};

export default function Variations({
  helpText = 'Add options like Size, Spice Level, or Toppings',
  value,
  onChange,
  uploadUrl,
  authToken,
  onImageAdd,
  onImageRemove,
}: {
  helpText?: string;
  value?: VariationsValue[];
  onChange?: (rows: VariationsValue[]) => void;
  uploadUrl?: string;
  authToken?: string;
  onImageAdd?: (index: number, url: string) => void;
  onImageRemove?: (index: number, url?: string) => void;
}) {
  const [group, setGroup] = useState<VariationGroup | null>(null);

  // Seed from props exactly once (when group is null)
  useEffect(() => {
    if (group || !value || value.length === 0) return;
    const values: VariantValue[] = value.map((v) => {
      const preview = v.imagePreview ?? v.imageUrl ?? null;
      const url = v.imageUrl ?? (preview && !preview.startsWith('blob:') ? preview : null);
      return {
        id: cryptoId(),
        label: v.label,
        price: v.price,
        imagePreview: preview,
        imageUrl: url,
        imageFile: null,
      };
    });
    setGroup({ id: cryptoId(), editing: false, values: normalizeInputs(values) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Sync from props -> rows, but only if content actually differs
  useEffect(() => {
    if (!value) return;
    setGroup((g) => {
      if (!g) return g;

      const map = new Map(
        value.map((v) => {
          const preview = v.imagePreview ?? v.imageUrl ?? null;
          const url = v.imageUrl ?? (preview && !preview.startsWith('blob:') ? preview : null);
          return [v.label, { preview, url, price: v.price }];
        })
      );

      const typedCurrent = g.values.filter((v) => v.label.trim() !== '');

      // Build signatures in the same order (current rows' order) to avoid false diffs
      const curSig = JSON.stringify(
        typedCurrent.map((v) => [v.label, v.imagePreview ?? null, v.imageUrl ?? null, v.price ?? ''])
      );
      const nextSig = JSON.stringify(
        typedCurrent.map((v) => {
          const f = map.get(v.label);
          const nextPreview = f?.preview ?? null;
          const nextUrl = f?.url ?? null;
          const nextPrice = f?.price ?? '';
          return [v.label, nextPreview, nextUrl, nextPrice];
        })
      );

      if (curSig === nextSig) return g;

      const nextValues = g.values.map((r) => {
        if (r.label.trim() === '') return r;
        const f = map.get(r.label);
        if (!f) return r;

        const nextPreview = f.preview;
        const nextUrl = f.url;
        const nextPrice = f.price;

        if (
          r.imagePreview === nextPreview &&
          r.imageUrl === nextUrl &&
          (nextPrice === undefined || r.price === nextPrice)
        ) {
          return r;
        }

        if (r.imagePreview && r.imagePreview.startsWith('blob:') && r.imagePreview !== nextPreview) {
          safeRevoke(r.imagePreview);
        }
        return { ...r, imagePreview: nextPreview, imageUrl: nextUrl, price: nextPrice ?? r.price };
      });

      return { ...g, values: nextValues };
    });
  }, [value]);

  const updateValues = (next: VariantValue[]) =>
    setGroup((g) => (g ? { ...g, values: normalizeInputs(next) } : g));

  const setValue = (index: number, patch: Partial<VariantValue>) => {
    if (!group) return;
    const next = [...group.values];
    const prev = next[index];
    if (patch.imagePreview && prev?.imagePreview && prev.imagePreview !== patch.imagePreview) {
      safeRevoke(prev.imagePreview);
    }
    next[index] = { ...prev, ...patch };
    updateValues(next);
  };

  const removeValue = (index: number) => {
    if (!group) return;
    const next = [...group.values];
    const v = next[index];
    safeRevoke(v?.imagePreview || null);
    next.splice(index, 1);
    updateValues(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const typed = useMemo(() => (group?.values || []).filter((v) => v.label.trim() !== ''), [group?.values]);

  // Emit to parent only on actual change
  const lastEmitRef = useRef<string>('');
  useEffect(() => {
    if (!onChange) return;
    const payload: VariationsValue[] = typed.map((r) => ({
      label: r.label,
      price: r.price,
      imagePreview: r.imagePreview ?? null,
      imageUrl: r.imageUrl ?? (r.imagePreview && !r.imagePreview.startsWith('blob:') ? r.imagePreview : null),
    }));
    const sig = JSON.stringify(payload);
    if (sig === lastEmitRef.current) return;
    lastEmitRef.current = sig;
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

  async function uploadVariantImage(file: File): Promise<string> {
    if (!uploadUrl) return '';
    const fd = new FormData();
    fd.append('file', file);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const resp = await fetch(uploadUrl, { method: 'POST', body: fd, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && data.error) || 'Upload failed');
    const url: string = data?.cdn?.medium || data?.cdn?.original || data?.url || data?.location || '';
    return url;
  }

  const handlePickFile = async (idx: number, file: File, blobUrl: string) => {
    setValue(idx, { imageFile: file, imagePreview: blobUrl });
    try {
      const cdn = await uploadVariantImage(file);
      if (cdn) {
        setValue(idx, { imagePreview: cdn, imageUrl: cdn, imageFile: null });
        onImageAdd?.(idx, cdn);
      }
      try {
        if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
      } catch {}
    } catch {}
  };

  const rows = typed;

  return (
    <div className="text-[#2e2e30]">
      <div className="mb-2 flex items-center gap-2">
        <span className="block text-sm font-medium text-[#2e2e30]">Variations</span>
        <span className="relative inline-flex items-center align-middle group cursor-pointer">
          <QuestionMarkCircleIcon className="h-4 w-4 text-[#6b7280] group-hover:text-[#374151]" />
          <HoverCard label={helpText} placement="right" />
        </span>
      </div>

      {!group ? (
        <button
          type="button"
          onClick={() => setGroup({ id: cryptoId(), editing: true, values: [{ id: cryptoId(), label: '' }] })}
          className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm font-medium text-[#2e2e30] transition-colors hover:bg-[#f6f6f6]"
        >
          <PlusCircleIcon className="h-5 w-5 text-[#2e2e30]" />
          Add Options
        </button>
      ) : (
        <div className="space-y-5">
          {group.editing ? (
            <div className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc]">
              <div className="space-y-2 p-3">
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

                <div className="mt-2 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setGroup(null)}
                    className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-[#fff0f0]"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={rows.length === 0}
                    onClick={() => setGroup((g) => (g ? { ...g, editing: false, values: tidyValues(g.values) } : g))}
                    className={`rounded-md px-4 py-1.5 text-sm text-white ${
                      rows.length === 0 ? 'cursor-not-allowed bg-[#b0b0b5]' : 'bg-[#111827] hover:opacity-90'
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
                  onPickFile={(idx, file, url) => handlePickFile(idx, file, url)}
                  onRemoveImage={(idx) => {
                    const r = rows[idx];
                    const prevUrl =
                      r.imageUrl || (r.imagePreview && !r.imagePreview.startsWith('blob:') ? r.imagePreview : null);
                    if (group) {
                      const fullIndex = group.values.findIndex((v) => v.id === r.id);
                      if (fullIndex >= 0) setValue(fullIndex, { imageFile: null, imagePreview: null, imageUrl: null });
                    }
                    onImageRemove?.(idx, prevUrl || undefined);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc]">
              <div className="p-3">
                <div className="mb-2 flex flex-wrap gap-2">
                  {rows.length > 0 ? (
                    rows.map((v) => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 rounded-full bg-[#EFEFEF] px-3.5 py-1.5 text-sm text-[#2e2e30]"
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
                  className="flex w-full items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm font-medium text-[#2e2e30] transition-colors hover:bg-[#f6f6f6]"
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
                  onPickFile={(idx, file, url) => handlePickFile(idx, file, url)}
                  onRemoveImage={(idx) => {
                    const r = rows[idx];
                    const prevUrl =
                      r.imageUrl || (r.imagePreview && !r.imagePreview.startsWith('blob:') ? r.imagePreview : null);
                    if (group) {
                      const fullIndex = group.values.findIndex((v) => v.id === r.id);
                      if (fullIndex >= 0) setValue(fullIndex, { imageFile: null, imagePreview: null, imageUrl: null });
                    }
                    onImageRemove?.(idx, prevUrl || undefined);
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
    <div ref={setNodeRef} style={style} className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className={`shrink-0 rounded-md p-1.5 ${
          disabled ? 'cursor-not-allowed text-[#2e2e30] opacity-40' : 'cursor-grab text-[#2e2e30] active:cursor-grabbing'
        }`}
        aria-label={disabled ? 'Drag disabled' : 'Reorder option'}
        title={disabled ? '' : 'Drag to reorder'}
        {...handleProps}
      >
        <SixDotHandleIcon className="h-4 w-4" />
      </button>

      <input
        className="flex-1 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0"
        placeholder={`Option ${index + 1}`}
        value={item.label}
        onChange={(e) => onLabelChange((e.target as HTMLInputElement).value)}
      />

      {canRemove && (
        <button
          type="button"
          className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-2 py-2 text-sm text-red-600 transition-colors hover:bg-[#fff0f0]"
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
  onPickFile,
  onRemoveImage,
  readOnlyLabels,
}: {
  rows: VariantValue[];
  onChange: (index: number, patch: Partial<VariantValue>) => void;
  onPickFile: (index: number, file: File, blobUrl: string) => void;
  onRemoveImage?: (index: number, url?: string) => void;
  readOnlyLabels?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full overflow-x-hidden">
      <div className="w-full">
        <div className="grid grid-cols-[48px_1fr_120px] items-center gap-3 border-b border-[#dbdbdb] bg-[#f6f6f6] px-3 py-2">
          <div className="col-span-2 text-sm font-semibold text-[#2e2e30]">Variations</div>
          <div className="pr-1 text-right text-sm font-semibold text-[#2e2e30]">Price</div>
        </div>
        <div className="divide-y divide-[#dbdbdb]">
          {rows.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-[48px_1fr_120px] items-center gap-3 bg-[#fcfcfc] px-3 py-2">
              <TinyImageBox
                preview={r.imagePreview || null}
                onPick={(file, url) => onPickFile(idx, file, url)}
                onClear={() => {
                  onChange(idx, { imageFile: null, imagePreview: null, imageUrl: null });
                  const prevUrl =
                    r.imageUrl || (r.imagePreview && !r.imagePreview.startsWith('blob:') ? r.imagePreview : null);
                  onRemoveImage?.(idx, prevUrl || undefined);
                }}
              />
              <div className="truncate text-sm text-[#2e2e30]">{readOnlyLabels ? r.label : r.label}</div>
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
    <div className="flex items-center justify-end">
      <div className="inline-flex w-[120px] items-stretch">
        <span className="select-none rounded-l-md border border-[#dbdbdb] bg-[#fcfcfc] px-2 py-2 text-sm text-[#6b7280]">
          ৳
        </span>
        <input
          className="w-full -ml-px rounded-r-md rounded-l-none border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          inputMode="decimal"
        />
      </div>
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
  const hasImage = !!preview;

  return (
    <div className="relative h-12 w-12">
      <button
        type="button"
        className={`relative h-12 w-12 overflow-hidden rounded-md border ${
          hasImage ? 'border-[#dbdbdb]' : 'border-dashed border-[#dbdbdb]'
        } bg-[#fcfcfc] transition-colors hover:bg-[#f6f6f6]`}
        onClick={() => inputRef.current?.click()}
        aria-label="Pick variant image"
      >
        {hasImage ? (
          <img src={preview || ''} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PhotoIcon className="h-5 w-5 text-[#6b7280]" />
          </div>
        )}
      </button>

      {hasImage && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove image"
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#dbdbdb] bg-white/90 text-[11px] text-[#111827] shadow"
        >
          ×
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

function HoverCard({ label, placement = 'right' }: { label: string; placement?: 'bottom' | 'left' | 'right' }) {
  const pos =
    placement === 'left'
      ? 'right-full mr-2 top-1/2 -translate-y-1/2'
      : placement === 'right'
      ? 'left-full ml-2 top-1/2 -translate-y-1/2'
      : 'left-0 top-full mt-1';
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute ${pos} z-50 max-w-[22rem] rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-xs text-[#2e2e30] shadow-md opacity-0 transition duration-150 ease-out group-hover:translate-y-[2px] group-hover:opacity-100`}
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
    if (removed?.imagePreview?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(removed.imagePreview);
      } catch {}
    }
    i--;
  }
  if (next[next.length - 1].label.trim() !== '') next.push({ id: cryptoId(), label: '' });
  return next;
}
function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}