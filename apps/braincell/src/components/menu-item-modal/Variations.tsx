import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  PlusCircleIcon,
  PlusIcon,
  XMarkIcon,
  PhotoIcon,
  QuestionMarkCircleIcon,
  ChevronRightIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
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

import {
  MAX_VARIANTS,
  activeOptions,
  blankVariant,
  buildCombos,
  duplicateValueIds,
  isValidPrice,
  liveValues,
  normKey,
  optionProblems,
  reconcile,
  seedState,
  stableUrl,
  uid,
  withTrailingBlank,
  type Combo,
  type OptionDraft,
  type VariantOption,
  type VariantState,
  type VariationRow,
} from './variantMatrix';

export type { VariationRow, VariantOption } from './variantMatrix';

/** Common restaurant options: one click fills the name, then values are one click each. */
const OPTION_PRESETS: VariantOption[] = [
  { name: 'Size', values: ['Small', 'Medium', 'Large'] },
  { name: 'Spice level', values: ['Mild', 'Medium', 'Hot', 'Extra hot'] },
  { name: 'Portion', values: ['Half', 'Full'] },
  { name: 'Protein', values: ['Chicken', 'Beef', 'Mutton', 'Prawn', 'Veg'] },
  { name: 'Crust', values: ['Thin', 'Regular', 'Stuffed'] },
  { name: 'Temperature', values: ['Hot', 'Iced'] },
];

/** Groups start expanded while the table is small enough to scan. */
const AUTO_EXPAND_LIMIT = 12;

const safeRevoke = (url?: string | null) => {
  if (!url || !url.startsWith('blob:')) return;
  requestAnimationFrame(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
};

export default function Variations({
  helpText = 'Add options like Size or Spice level. Every combination becomes a variant with its own price.',
  value,
  options,
  onChange,
  uploadUrl,
  authToken,
  onImageRemove,
  mediaUrls = [],
  // trigger to validate prices on demand (Save clicked)
  validatePricesTick = 0,
  itemPrepMinutes = '',
}: {
  helpText?: string;
  value?: VariationRow[];
  options?: VariantOption[];
  /** `issue` is a blocking problem (missing option name, too many variants, ...) or null */
  onChange?: (rows: VariationRow[], options: VariantOption[], issue: string | null) => void;
  uploadUrl?: string;
  authToken?: string;
  onImageRemove?: (url: string) => void;
  mediaUrls?: string[];
  validatePricesTick?: number;
  /** The item's prep minutes — a variant with no time of its own uses it */
  itemPrepMinutes?: string;
}) {
  const [state, setState] = useState(() => seedState(value, options));
  const [groupBy, setGroupBy] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);

  const { combos, total } = useMemo(() => buildCombos(state.options), [state.options]);
  const active = useMemo(() => activeOptions(state.options), [state.options]);

  // Options the user has started filling in; fully blank ones are ignored
  const meaningful = useMemo(
    () => state.options.filter((o) => o.name.trim() || liveValues(o).length),
    [state.options]
  );
  const problemsById = useMemo(
    () => new Map(optionProblems(meaningful).map((p) => [p.id, p])),
    [meaningful]
  );

  const allOff = combos.length > 0 && combos.every((c) => state.variants[c.key]?.disabled);

  const issue = useMemo(() => {
    if (total > MAX_VARIANTS) {
      return `Too many variants (${total}). Keep it to ${MAX_VARIANTS} or fewer by removing some values.`;
    }
    for (const p of problemsById.values()) {
      if (p.nameError || p.valuesError || p.hasDuplicateValues) return 'Fix the highlighted variant options.';
    }
    if (allOff) return 'Offer at least one variant, or delete the options.';
    return null;
  }, [total, problemsById, allOff]);

  /* ---------------- state updaters ---------------- */

  const updateOptions = (fn: (opts: OptionDraft[]) => OptionDraft[]) =>
    setState((s) => {
      const options = fn(s.options);
      return { options, variants: reconcile(options, s.variants) };
    });

  const patchOption = (id: string, patch: Partial<OptionDraft>) =>
    updateOptions((opts) => opts.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const setValueLabel = (optId: string, valId: string, label: string) =>
    updateOptions((opts) =>
      opts.map((o) =>
        o.id !== optId
          ? o
          : { ...o, values: withTrailingBlank(o.values.map((v) => (v.id === valId ? { ...v, label } : v))) }
      )
    );

  const removeValue = (optId: string, valId: string) =>
    updateOptions((opts) =>
      opts.map((o) => (o.id !== optId ? o : { ...o, values: withTrailingBlank(o.values.filter((v) => v.id !== valId)) }))
    );

  const addValues = (optId: string, labels: string[]) =>
    updateOptions((opts) =>
      opts.map((o) => {
        if (o.id !== optId) return o;
        const typed = o.values.filter((v) => v.label.trim());
        return { ...o, values: withTrailingBlank([...typed, ...labels.map((label) => ({ id: uid(), label }))]) };
      })
    );

  const reorderValues = (optId: string, fromId: string, toId: string) =>
    updateOptions((opts) =>
      opts.map((o) => {
        if (o.id !== optId) return o;
        const typed = o.values.filter((v) => v.label.trim());
        const from = typed.findIndex((v) => v.id === fromId);
        let to = typed.findIndex((v) => v.id === toId);
        if (from < 0) return o;
        if (to < 0) to = typed.length - 1;
        return { ...o, values: withTrailingBlank(arrayMove(typed, from, to)) };
      })
    );

  const addOption = () =>
    updateOptions((opts) => [...opts, { id: uid(), name: '', editing: true, values: [{ id: uid(), label: '' }] }]);

  const deleteOption = (id: string) => {
    const opt = state.options.find((o) => o.id === id);
    const ids = new Set(opt?.values.map((v) => v.id));
    // Images owned only by variants that disappear with this option get released
    Object.entries(state.variants).forEach(([k, v]) => {
      if (k.split('|').some((x) => ids.has(x))) safeRevoke(v.imagePreview);
    });
    updateOptions((opts) => opts.filter((o) => o.id !== id));
    setTouched((t) => {
      const n = new Set(t);
      n.delete(id);
      return n;
    });
  };

  const finishOption = (o: OptionDraft) => {
    setTouched((t) => new Set(t).add(o.id));
    if (!o.name.trim() && !liveValues(o).length) {
      deleteOption(o.id);
      return;
    }
    const p = problemsById.get(o.id);
    if (p && (p.nameError || p.valuesError || p.hasDuplicateValues)) return;
    patchOption(o.id, {
      editing: false,
      name: o.name.trim(),
      values: withTrailingBlank(o.values.filter((v) => v.label.trim()).map((v) => ({ ...v, label: v.label.trim() }))),
    });
  };

  const patchVariants = (keys: string[], patch: Partial<VariantState>) =>
    setState((s) => {
      let changed = false;
      const variants = { ...s.variants };
      for (const k of keys) {
        if (!variants[k]) continue; // combination changed while an upload was in flight
        variants[k] = { ...variants[k], ...patch };
        changed = true;
      }
      return changed ? { ...s, variants } : s;
    });

  const setPrice = (keys: string[], price: string) =>
    patchVariants(keys, { price, ...(isValidPrice(price) ? { priceError: null } : {}) });
  const setPrep = (keys: string[], prepMinutes: string) => patchVariants(keys, { prepMinutes });

  /* ---------------- emit to parent ---------------- */

  const lastEmitRef = useRef<string>('');
  useEffect(() => {
    if (!onChange) return;
    const optionsOut: VariantOption[] = active.map((o) => ({
      name: o.name.trim(),
      values: liveValues(o).map((v) => v.label.trim()),
    }));
    const rows: VariationRow[] = combos
      .filter((c) => !state.variants[c.key]?.disabled)
      .map((c) => {
        const v = state.variants[c.key] ?? blankVariant();
        return {
          label: c.labels.join(' / '),
          optionValues: c.labels,
          price: v.price,
          prepMinutes: v.prepMinutes || '',
          imagePreview: v.imagePreview ?? null,
          imageUrl: v.imageUrl ?? stableUrl(v.imagePreview),
        };
      });
    const sig = JSON.stringify([rows, optionsOut, issue]);
    if (sig === lastEmitRef.current) return;
    lastEmitRef.current = sig;
    onChange(rows, optionsOut, issue);
  }, [active, combos, state.variants, issue, onChange]);

  /* ---------------- validation on Save ---------------- */

  const groupIdx = Math.min(groupBy, Math.max(0, active.length - 1));
  const multi = active.length > 1;

  const initialTickRef = useRef(validatePricesTick);
  useEffect(() => {
    if (validatePricesTick === initialTickRef.current) return;
    setShowAllErrors(true);

    const badKeys = new Set(
      combos.filter((c) => !state.variants[c.key]?.disabled && !isValidPrice(state.variants[c.key]?.price)).map((c) => c.key)
    );
    setState((s) => {
      const variants = { ...s.variants };
      for (const c of combos) {
        const v = variants[c.key];
        if (!v) continue;
        const priceError = badKeys.has(c.key) ? 'Enter a price' : null;
        if ((v.priceError ?? null) !== priceError) variants[c.key] = { ...v, priceError };
      }
      // Re-open options that still need attention
      const options = s.options.map((o) => {
        const p = problemsById.get(o.id);
        return p && (p.nameError || p.valuesError || p.hasDuplicateValues) ? { ...o, editing: true } : o;
      });
      return { options, variants };
    });

    if (multi && badKeys.size) {
      setExpanded((e) => {
        const next = { ...e };
        combos.forEach((c) => {
          if (badKeys.has(c.key)) next[c.ids[groupIdx]] = true;
        });
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validatePricesTick]);

  /* ---------------- images ---------------- */

  const mediaSet = useMemo(() => new Set((mediaUrls || []).filter(Boolean)), [mediaUrls]);

  async function uploadImage(file: File): Promise<string> {
    if (!uploadUrl) return '';
    const fd = new FormData();
    fd.append('file', file);
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const resp = await fetch(uploadUrl, { method: 'POST', body: fd, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && data.error) || 'Upload failed');
    return data?.cdn?.medium || data?.cdn?.original || data?.url || data?.location || '';
  }

  const pickImage = async (keys: string[], file: File, blobUrl: string) => {
    patchVariants(keys, { imagePreview: blobUrl, imageUrl: null, uploading: true, imageError: null });
    try {
      const cdn = await uploadImage(file);
      if (!cdn) {
        patchVariants(keys, { uploading: false });
      } else if (mediaSet.has(cdn)) {
        patchVariants(keys, {
          uploading: false,
          imageError: 'This image is already in Media',
          imagePreview: null,
          imageUrl: null,
        });
      } else {
        patchVariants(keys, { imagePreview: cdn, imageUrl: cdn, uploading: false, imageError: null });
      }
      safeRevoke(blobUrl);
    } catch (err: any) {
      patchVariants(keys, { uploading: false, imageError: err?.message || 'Upload failed', imagePreview: null });
    }
  };

  const clearImage = (keys: string[]) => {
    const keySet = new Set(keys);
    const urls = new Set<string>();
    keys.forEach((k) => {
      const v = state.variants[k];
      const u = stableUrl(v?.imageUrl ?? v?.imagePreview);
      if (u) urls.add(u);
      safeRevoke(v?.imagePreview);
    });
    patchVariants(keys, { imagePreview: null, imageUrl: null, uploading: false, imageError: null });
    // Only drop the image from the item if no remaining variant still shows it
    urls.forEach((u) => {
      const stillUsed = Object.entries(state.variants).some(
        ([k, v]) => !keySet.has(k) && stableUrl(v.imageUrl ?? v.imagePreview) === u
      );
      if (!stillUsed) onImageRemove?.(u);
    });
  };

  /* ---------------- drag & drop (options) ---------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onOptionDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e;
    if (!a || !over || a.id === over.id) return;
    updateOptions((opts) => {
      const from = opts.findIndex((o) => o.id === a.id);
      const to = opts.findIndex((o) => o.id === over.id);
      return from < 0 || to < 0 ? opts : arrayMove(opts, from, to);
    });
  };

  const usedNames = useMemo(() => new Set(state.options.map((o) => normKey(o.name)).filter(Boolean)), [state.options]);

  return (
    <div className="text-[#2e2e30]">
      <div className="mb-2 flex items-center gap-2">
        <span className="block text-sm font-medium text-[#2e2e30]">Variations</span>
        <span className="relative inline-flex items-center align-middle group cursor-pointer">
          <QuestionMarkCircleIcon className="h-4 w-4 text-[#6b7280] group-hover:text-[#374151]" />
          <HoverCard label={helpText} placement="right" />
        </span>
      </div>

      {state.options.length === 0 ? (
        <button
          type="button"
          onClick={addOption}
          className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm font-medium text-[#2e2e30] transition-colors hover:bg-[#f6f6f6]"
        >
          <PlusCircleIcon className="h-5 w-5 text-[#2e2e30]" />
          Add options like size or spice level
        </button>
      ) : (
        <div className="overflow-hidden rounded-md border border-[#dbdbdb] bg-[#fcfcfc]">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onOptionDragEnd}>
            <SortableContext items={state.options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-[#dbdbdb]">
                {state.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    option={o}
                    problems={problemsById.get(o.id)}
                    showErrors={showAllErrors || touched.has(o.id)}
                    usedNames={usedNames}
                    onEdit={() => patchOption(o.id, { editing: true })}
                    onNameChange={(name) => patchOption(o.id, { name })}
                    onNameBlur={() => o.name.trim() && setTouched((t) => new Set(t).add(o.id))}
                    onValueChange={(valId, label) => setValueLabel(o.id, valId, label)}
                    onValueRemove={(valId) => removeValue(o.id, valId)}
                    onValuesAdd={(labels) => addValues(o.id, labels)}
                    onValuesReorder={(from, to) => reorderValues(o.id, from, to)}
                    onDelete={() => deleteOption(o.id)}
                    onDone={() => finishOption(o)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="border-t border-[#dbdbdb] px-3 py-2">
            <button
              type="button"
              onClick={addOption}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-[#2e2e30] hover:underline"
            >
              <PlusIcon className="h-4 w-4" />
              Add another option
            </button>
          </div>

          {total > MAX_VARIANTS && (
            <div className="border-t border-[#dbdbdb] bg-[#fff7ed] px-3 py-2 text-sm text-[#9a3412]" role="alert">
              {issue}
            </div>
          )}

          {combos.length > 0 && (
            <VariantTable
              active={active}
              combos={combos}
              variants={state.variants}
              groupIdx={groupIdx}
              onGroupByChange={(i) => {
                setGroupBy(i);
                setExpanded({});
              }}
              isExpanded={(groupId) => expanded[groupId] ?? combos.length <= AUTO_EXPAND_LIMIT}
              onToggleExpanded={(groupId, open) => setExpanded((e) => ({ ...e, [groupId]: open }))}
              onSetAllExpanded={(open) =>
                setExpanded(Object.fromEntries(liveValues(active[groupIdx]).map((v) => [v.id, open])))
              }
              onPrice={setPrice}
              onPrep={setPrep}
              itemPrep={itemPrepMinutes}
              onPickImage={pickImage}
              onClearImage={clearImage}
              onToggleOffered={(key) =>
                patchVariants([key], { disabled: !state.variants[key]?.disabled, priceError: null })
              }
            />
          )}

          {allOff && (
            <div className="border-t border-[#dbdbdb] px-3 py-2 text-xs text-red-600" role="alert">
              {issue}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ====================================================================== */
/*  Option card (edit + summary modes)                                     */
/* ====================================================================== */

function OptionCard({
  option,
  problems,
  showErrors,
  usedNames,
  onEdit,
  onNameChange,
  onNameBlur,
  onValueChange,
  onValueRemove,
  onValuesAdd,
  onValuesReorder,
  onDelete,
  onDone,
}: {
  option: OptionDraft;
  problems?: ReturnType<typeof optionProblems>[number];
  showErrors: boolean;
  usedNames: Set<string>;
  onEdit: () => void;
  onNameChange: (name: string) => void;
  onNameBlur: () => void;
  onValueChange: (valId: string, label: string) => void;
  onValueRemove: (valId: string) => void;
  onValuesAdd: (labels: string[]) => void;
  onValuesReorder: (fromId: string, toId: string) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: option.id });
  const cardRef = useRef<HTMLDivElement | null>(null);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
    position: 'relative',
  };
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    cardRef.current = el;
  };

  const typed = option.values.filter((v) => v.label.trim());
  const dupIds = useMemo(() => duplicateValueIds(option), [option]);

  const valueSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const nameError = showErrors ? problems?.nameError : null;
  const valuesError = showErrors ? problems?.valuesError : null;

  const preset = OPTION_PRESETS.find((p) => normKey(p.name) === normKey(option.name));
  const existing = new Set(typed.map((v) => normKey(v.label)));
  const valueSuggestions = preset ? preset.values.filter((v) => !existing.has(normKey(v))) : [];
  const nameSuggestions = option.name.trim()
    ? []
    : OPTION_PRESETS.map((p) => p.name).filter((n) => !usedNames.has(normKey(n)));

  const valueInputs = () =>
    Array.from(cardRef.current?.querySelectorAll<HTMLInputElement>('input[data-value-input]') ?? []);

  const onValueKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // never submit the whole item form from here
    const isLast = index === option.values.length - 1;
    if (isLast && !option.values[index].label.trim()) {
      onDone();
      return;
    }
    // Next input exists once this value is typed (there's always a trailing blank)
    requestAnimationFrame(() => valueInputs()[index + 1]?.focus());
  };

  const handle = (
    <button
      type="button"
      className="mt-0.5 shrink-0 cursor-grab rounded-md p-1.5 text-[#6b7280] hover:text-[#2e2e30] active:cursor-grabbing"
      aria-label={`Reorder option ${option.name || ''}`.trim()}
      title="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <SixDotHandleIcon className="h-4 w-4" />
    </button>
  );

  if (!option.editing) {
    return (
      <div ref={setRefs} style={style} className="flex items-start gap-2 bg-[#fcfcfc] p-3 transition-colors hover:bg-[#f6f6f6]">
        {handle}
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left" aria-label={`Edit option ${option.name}`}>
          <div className="text-sm font-semibold text-[#2e2e30]">{option.name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {typed.map((v) => (
              <span key={v.id} className="inline-flex items-center rounded-full bg-[#EFEFEF] px-3 py-1 text-sm text-[#2e2e30]">
                {v.label}
              </span>
            ))}
          </div>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md px-2 py-1 text-sm text-[#6b7280] hover:bg-[#ececec] hover:text-[#2e2e30]"
        >
          Edit
        </button>
      </div>
    );
  }

  const nameInputId = `opt-name-${option.id}`;

  return (
    <div ref={setRefs} style={style} className="flex items-start gap-2 bg-[#fcfcfc] p-3">
      {handle}
      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <label htmlFor={nameInputId} className="mb-1 block text-xs font-medium text-[#6b7280]">
            Option name
          </label>
          <input
            id={nameInputId}
            autoFocus={!option.name && typed.length === 0}
            className={`w-full rounded-md border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 ${
              nameError ? 'border-red-500' : 'border-[#dbdbdb]'
            }`}
            placeholder="e.g. Size"
            value={option.name}
            maxLength={60}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onNameBlur}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              valueInputs()[0]?.focus();
            }}
            aria-invalid={!!nameError || undefined}
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-600" role="alert">
              {nameError}
            </p>
          )}
          {nameSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {nameSuggestions.map((n) => (
                <SuggestionChip
                  key={n}
                  label={n}
                  onClick={() => {
                    onNameChange(n);
                    requestAnimationFrame(() => valueInputs()[0]?.focus());
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-[#6b7280]">Option values</span>
          <DndContext
            sensors={valueSensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => {
              if (e.active && e.over && e.active.id !== e.over.id) onValuesReorder(String(e.active.id), String(e.over.id));
            }}
          >
            <SortableContext items={option.values.map((v) => v.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {option.values.map((v, i) => {
                  const isTrailing = i === option.values.length - 1 && !v.label.trim();
                  return (
                    <ValueRow
                      key={v.id}
                      id={v.id}
                      label={v.label}
                      placeholder={isTrailing ? (typed.length ? 'Add another value' : 'e.g. Small') : ''}
                      draggable={!!v.label.trim()}
                      error={dupIds.has(v.id) ? 'This value is already added' : null}
                      invalid={!!valuesError && i === 0}
                      canRemove={!isTrailing}
                      onChange={(label) => onValueChange(v.id, label)}
                      onRemove={() => onValueRemove(v.id)}
                      onKeyDown={(e) => onValueKeyDown(e, i)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          {valuesError && (
            <p className="mt-1 text-xs text-red-600" role="alert">
              {valuesError}
            </p>
          )}
          {valueSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#6b7280]">Quick add:</span>
              {valueSuggestions.map((s) => (
                <SuggestionChip key={s} label={s} onClick={() => onValuesAdd([s])} />
              ))}
              {valueSuggestions.length > 1 && (
                <button
                  type="button"
                  onClick={() => onValuesAdd(valueSuggestions)}
                  className="px-1 text-xs font-medium text-[#2e2e30] underline-offset-2 hover:underline"
                >
                  Add all
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-[#fff0f0]"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md bg-[#111827] px-4 py-1.5 text-sm text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ValueRow({
  id,
  label,
  placeholder,
  draggable,
  error,
  invalid,
  canRemove,
  onChange,
  onRemove,
  onKeyDown,
}: {
  id: string;
  label: string;
  placeholder: string;
  draggable: boolean;
  error: string | null;
  invalid: boolean;
  canRemove: boolean;
  onChange: (label: string) => void;
  onRemove: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };
  const errorId = error ? `val-err-${id}` : undefined;

  return (
    <div ref={setNodeRef} style={style} className="flex min-w-0 items-start gap-2">
      <button
        type="button"
        className={`mt-1 shrink-0 rounded-md p-1.5 ${
          draggable ? 'cursor-grab text-[#6b7280] active:cursor-grabbing' : 'invisible'
        }`}
        aria-label="Reorder value"
        {...(draggable ? { ...attributes, ...listeners } : { tabIndex: -1 })}
      >
        <SixDotHandleIcon className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <input
          data-value-input
          className={`w-full rounded-md border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 ${
            error || invalid ? 'border-red-500' : 'border-[#dbdbdb]'
          }`}
          placeholder={placeholder}
          value={label}
          maxLength={60}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={!!error || invalid || undefined}
          aria-describedby={errorId}
        />
        {error && (
          <p id={errorId} className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      {canRemove ? (
        <button
          type="button"
          className="shrink-0 rounded-md p-2 text-[#6b7280] transition-colors hover:bg-[#fff0f0] hover:text-red-600"
          onClick={onRemove}
          aria-label={`Remove ${label || 'value'}`}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      ) : (
        <span className="w-9 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}

function SuggestionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#c7c7c9] px-2.5 py-0.5 text-xs text-[#2e2e30] transition-colors hover:border-[#111827] hover:bg-[#f6f6f6]"
    >
      <PlusIcon className="h-3 w-3" />
      {label}
    </button>
  );
}

/* ====================================================================== */
/*  Variant table: flat for one option, grouped (expandable) for several   */
/* ====================================================================== */

function VariantTable({
  active,
  combos,
  variants,
  groupIdx,
  onGroupByChange,
  isExpanded,
  onToggleExpanded,
  onSetAllExpanded,
  onPrice,
  onPrep,
  itemPrep,
  onPickImage,
  onClearImage,
  onToggleOffered,
}: {
  active: OptionDraft[];
  combos: Combo[];
  variants: Record<string, VariantState>;
  groupIdx: number;
  onGroupByChange: (i: number) => void;
  isExpanded: (groupId: string) => boolean;
  onToggleExpanded: (groupId: string, open: boolean) => void;
  onSetAllExpanded: (open: boolean) => void;
  onPrice: (keys: string[], price: string) => void;
  onPrep: (keys: string[], minutes: string) => void;
  /** The item's own prep time (placeholder for "same as the item") */
  itemPrep: string;
  onPickImage: (keys: string[], file: File, blobUrl: string) => void;
  onClearImage: (keys: string[]) => void;
  onToggleOffered: (key: string) => void;
}) {
  const multi = active.length > 1;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState('');

  const offeredKeys = combos.filter((c) => !variants[c.key]?.disabled).map((c) => c.key);

  const groups = useMemo(() => {
    if (!multi) return [];
    return liveValues(active[groupIdx]).map((v) => ({
      id: v.id,
      label: v.label.trim(),
      combos: combos.filter((c) => c.ids[groupIdx] === v.id),
    }));
  }, [multi, active, groupIdx, combos]);

  const applyBulk = () => {
    if (!isValidPrice(bulkPrice)) return;
    onPrice(offeredKeys, bulkPrice.trim());
    setBulkOpen(false);
    setBulkPrice('');
  };

  const anyCollapsed = groups.some((g) => !isExpanded(g.id));

  return (
    <div className="w-full border-t border-[#dbdbdb]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#f6f6f6] px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          {multi ? (
            <>
              <label htmlFor="variant-group-by" className="text-[#6b7280]">
                Group by
              </label>
              <select
                id="variant-group-by"
                value={groupIdx}
                onChange={(e) => onGroupByChange(Number(e.target.value))}
                className="rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-2 py-1 text-sm text-[#2e2e30] focus:border-[#111827] focus:outline-none"
              >
                {active.map((o, i) => (
                  <option key={o.id} value={i}>
                    {o.name.trim() || `Option ${i + 1}`}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="font-semibold text-[#2e2e30]">Variants</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {multi && (
            <button
              type="button"
              onClick={() => onSetAllExpanded(anyCollapsed)}
              className="text-[#2e2e30] underline-offset-2 hover:underline"
            >
              {anyCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          {offeredKeys.length > 1 && !bulkOpen && (
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="text-[#2e2e30] underline-offset-2 hover:underline"
            >
              Set all prices
            </button>
          )}
        </div>
      </div>

      {bulkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2">
          <span className="text-sm text-[#2e2e30]">Price for all {offeredKeys.length} variants</span>
          <div className="ml-auto flex items-center gap-2">
            <CurrencyCell
              value={bulkPrice}
              onChange={setBulkPrice}
              autoFocus
              onEnter={applyBulk}
              ariaLabel="Price for all variants"
            />
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                setBulkPrice('');
              }}
              className="rounded-md border border-[#dbdbdb] px-3 py-2 text-sm hover:bg-[#f6f6f6]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!isValidPrice(bulkPrice)}
              onClick={applyBulk}
              className={`rounded-md px-3 py-2 text-sm text-white ${
                isValidPrice(bulkPrice) ? 'bg-[#111827] hover:opacity-90' : 'cursor-not-allowed bg-[#b0b0b5]'
              }`}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Column header */}
      <div className="flex items-center gap-3 border-y border-[#dbdbdb] bg-[#f6f6f6] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
        <div className="flex-1">Variant</div>
        <div className="w-[72px] text-right" title="Kitchen minutes when this variant takes longer or shorter than the item">
          Prep
        </div>
        <div className={`w-[120px] text-right ${multi ? 'mr-9' : ''}`}>Price</div>
      </div>

      <div className="divide-y divide-[#dbdbdb]">
        {multi
          ? groups.map((g) => {
              const open = isExpanded(g.id);
              const offered = g.combos.filter((c) => !variants[c.key]?.disabled);
              const keys = offered.map((c) => c.key);
              const prices = offered.map((c) => variants[c.key]?.price ?? '');
              const same = prices.length > 0 && prices.every((p) => p === prices[0]);
              const nums = prices.filter(isValidPrice).map(Number);
              const range =
                nums.length && !same
                  ? `${Math.min(...nums)} – ${Math.max(...nums)}`
                  : '0.00';
              const imgs = offered.map((c) => variants[c.key]?.imagePreview ?? null);
              const sharedImg = imgs.length && imgs.every((u) => u === imgs[0]) ? imgs[0] : null;
              const uploading = offered.some((c) => variants[c.key]?.uploading);
              const hasPriceError = offered.some((c) => variants[c.key]?.priceError);
              const groupImageError = offered.map((c) => variants[c.key]?.imageError).find(Boolean) ?? null;
              const regionId = `variant-group-${g.id}`;

              return (
                <div key={g.id}>
                  <div className="flex items-center gap-3 bg-[#fcfcfc] px-3 py-2">
                    <TinyImageBox
                      preview={sharedImg}
                      loading={uploading && !!sharedImg}
                      disabled={keys.length === 0}
                      onPick={(file, url) => onPickImage(keys, file, url)}
                      onClear={() => onClearImage(keys)}
                      label={`Image for all ${g.label} variants`}
                    />
                    <button
                      type="button"
                      onClick={() => onToggleExpanded(g.id, !open)}
                      aria-expanded={open}
                      aria-controls={regionId}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#2e2e30]">{g.label}</span>
                        <span className="flex items-center gap-0.5 text-xs text-[#6b7280]">
                          {offered.length} variant{offered.length === 1 ? '' : 's'}
                          <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </span>
                      </span>
                    </button>
                    <MinutesCell
                      value={((ps) => (ps.length && ps.every((p) => p === ps[0]) ? ps[0] : ''))(
                        offered.map((c) => variants[c.key]?.prepMinutes ?? '')
                      )}
                      placeholder={itemPrep}
                      disabled={keys.length === 0}
                      onChange={(v) => onPrep(keys, v)}
                      ariaLabel={`Prep minutes for all ${g.label} variants`}
                    />
                    <CurrencyCell
                      value={same ? prices[0] : ''}
                      placeholder={range}
                      invalid={hasPriceError && !open}
                      disabled={keys.length === 0}
                      onChange={(v) => onPrice(keys, v)}
                      ariaLabel={`Price for all ${g.label} variants`}
                    />
                    <span className="w-6 shrink-0" aria-hidden="true" />
                  </div>
                  {groupImageError && (
                    <div className="px-3 pb-2 text-xs text-red-600" role="alert">
                      {groupImageError}
                    </div>
                  )}
                  {open && (
                    <div id={regionId} className="divide-y divide-[#ececec] border-t border-[#ececec] bg-white">
                      {g.combos.map((c) => (
                        <VariantRow
                          key={c.key}
                          label={c.labels.filter((_, i) => i !== groupIdx).join(' / ')}
                          variant={variants[c.key] ?? blankVariant()}
                          indent
                          itemPrep={itemPrep}
                          onPrep={(v) => onPrep([c.key], v)}
                          onPrice={(v) => onPrice([c.key], v)}
                          onPickImage={(file, url) => onPickImage([c.key], file, url)}
                          onClearImage={() => onClearImage([c.key])}
                          onToggleOffered={() => onToggleOffered(c.key)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          : combos.map((c) => (
              <VariantRow
                key={c.key}
                label={c.labels.join(' / ')}
                variant={variants[c.key] ?? blankVariant()}
                itemPrep={itemPrep}
                onPrep={(v) => onPrep([c.key], v)}
                onPrice={(v) => onPrice([c.key], v)}
                onPickImage={(file, url) => onPickImage([c.key], file, url)}
                onClearImage={() => onClearImage([c.key])}
              />
            ))}
      </div>

      <div className="border-t border-[#dbdbdb] bg-[#f6f6f6] px-3 py-2 text-xs text-[#6b7280]">
        {offeredKeys.length === combos.length
          ? `${combos.length} variant${combos.length === 1 ? '' : 's'}`
          : `${offeredKeys.length} of ${combos.length} variants offered`}
      </div>
    </div>
  );
}

function VariantRow({
  label,
  variant,
  indent,
  itemPrep,
  onPrep,
  onPrice,
  onPickImage,
  onClearImage,
  onToggleOffered,
}: {
  label: string;
  variant: VariantState;
  indent?: boolean;
  itemPrep: string;
  onPrep: (v: string) => void;
  onPrice: (v: string) => void;
  onPickImage: (file: File, blobUrl: string) => void;
  onClearImage: () => void;
  /** Only for multi-option items; single-option values are removed in the option editor */
  onToggleOffered?: () => void;
}) {
  const off = !!variant.disabled;
  const errors = off ? [] : ([variant.imageError, variant.priceError].filter(Boolean) as string[]);

  return (
    <div className={indent ? 'pl-8' : ''}>
      <div className="flex items-center gap-3 px-3 py-2">
        <div className={off ? 'opacity-40' : ''}>
          <TinyImageBox
            preview={variant.imagePreview}
            loading={!!variant.uploading}
            invalid={!!variant.imageError}
            disabled={off}
            onPick={onPickImage}
            onClear={onClearImage}
            small={indent}
            label={`Image for ${label}`}
          />
        </div>
        <div className={`min-w-0 flex-1 truncate text-sm ${off ? 'text-[#a9a9ab] line-through' : 'text-[#2e2e30]'}`}>
          {label}
        </div>
        {off ? (
          <span className="w-[204px] text-right text-xs text-[#a9a9ab]">Not offered</span>
        ) : (
          <>
            <MinutesCell
              value={variant.prepMinutes ?? ''}
              placeholder={itemPrep}
              onChange={onPrep}
              ariaLabel={`Prep minutes for ${label}`}
            />
            <CurrencyCell value={variant.price} invalid={!!variant.priceError} onChange={onPrice} ariaLabel={`Price for ${label}`} />
          </>
        )}
        {onToggleOffered && (
          <button
            type="button"
            onClick={onToggleOffered}
            title={off ? 'Offer this variant again' : "Don't offer this variant"}
            aria-label={off ? `Restore ${label}` : `Don't offer ${label}`}
            className={`w-6 shrink-0 rounded-md p-1 transition-colors ${
              off ? 'text-[#2e2e30] hover:bg-[#f0f0f0]' : 'text-[#6b7280] hover:bg-[#fff0f0] hover:text-red-600'
            }`}
          >
            {off ? <ArrowUturnLeftIcon className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
          </button>
        )}
      </div>
      {errors.map((msg, j) => (
        <div key={j} className="px-3 pb-2 text-xs text-red-600" role="alert" aria-live="polite">
          {msg}
        </div>
      ))}
    </div>
  );
}

/* ====================================================================== */
/*  Small building blocks                                                  */
/* ====================================================================== */

/** Whole minutes (empty = same as the item, shown as the placeholder). */
function MinutesCell({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const bad = value !== '' && (Number(value) < 1 || Number(value) > 240);
  return (
    <div className="inline-flex w-[72px] shrink-0 items-stretch">
      <input
        className={`w-full min-w-0 rounded-l-md border bg-[#fcfcfc] px-2 py-2 text-right text-sm text-[#2e2e30] placeholder-[#c4c4c7] hover:border-[#111827] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          bad ? 'border-red-500 focus:border-red-500' : 'border-[#dbdbdb] focus:border-[#111827]'
        }`}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title="Minutes — leave empty to use the item's prep time"
      />
      <span className="-ml-px select-none rounded-r-md border border-[#dbdbdb] bg-[#f6f6f6] px-1.5 py-2 text-xs text-[#6b7280]">
        m
      </span>
    </div>
  );
}

function CurrencyCell({
  value,
  onChange,
  invalid,
  disabled,
  placeholder = '0.00',
  autoFocus,
  onEnter,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  ariaLabel?: string;
}) {
  return (
    <div className="inline-flex w-[120px] shrink-0 items-stretch">
      <span className="select-none rounded-l-md border border-[#dbdbdb] bg-[#fcfcfc] px-2 py-2 text-sm text-[#6b7280]">
        ৳
      </span>
      <input
        className={`-ml-px w-full min-w-0 rounded-l-none rounded-r-md border bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] hover:border-[#111827] focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 ${
          invalid ? 'border-red-500 focus:border-red-500' : 'border-[#dbdbdb] focus:border-[#111827]'
        }`}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          // digits and a single decimal point only
          const cleaned = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
          onChange(cleaned);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onEnter?.();
        }}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function TinyImageBox({
  preview,
  onPick,
  onClear,
  loading,
  invalid,
  disabled,
  small,
  label = 'Pick variant image',
}: {
  preview: string | null;
  onPick: (file: File, previewUrl: string) => void;
  onClear: () => void;
  loading?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  small?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasImage = !!preview;
  const size = small ? 'h-10 w-10' : 'h-12 w-12';

  return (
    <div className={`relative shrink-0 ${size}`}>
      <button
        type="button"
        disabled={disabled}
        className={`relative ${size} overflow-hidden rounded-md border ${
          invalid ? 'border-red-500' : hasImage ? 'border-[#dbdbdb]' : 'border-dashed border-[#c7c7c9]'
        } bg-[#fcfcfc] transition-colors hover:bg-[#f6f6f6] disabled:cursor-not-allowed`}
        onClick={() => inputRef.current?.click()}
        aria-label={label}
        aria-busy={loading || undefined}
      >
        {hasImage ? (
          <img src={preview || ''} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PhotoIcon className="h-5 w-5 text-[#6b7280]" />
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
          </div>
        )}
      </button>

      {hasImage && !loading && !disabled && (
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
          const inputEl = e.target as HTMLInputElement;
          const file = inputEl.files?.[0];
          if (!file) return;
          onPick(file, URL.createObjectURL(file));
          inputEl.value = ''; // allow re-pick of same file
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
      className={`pointer-events-none absolute ${pos} z-50 w-max max-w-[22rem] rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-xs text-[#2e2e30] shadow-md opacity-0 transition duration-150 ease-out group-hover:translate-y-[2px] group-hover:opacity-100`}
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
