import { useEffect, useState } from 'react';
import {
  ClockIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  TrashIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import type { DraftItem, DraftItemAction } from '../../api/menuImports';
import { formatPrice, hasVariantPrice, itemBlockingIssue, parsePriceInput } from './draftUtils';

function PriceInput({
  value,
  onCommit,
  placeholder,
  invalid,
  ariaLabel,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder: string;
  invalid?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(typeof value === 'number' ? String(value) : '');
    setBad(false);
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parsePriceInput(text);
        if (Number.isNaN(n)) return setBad(true);
        setBad(false);
        if (n !== value) onCommit(n);
      }}
      className={`w-24 rounded-md border px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[#2e2e30] ${
        bad || invalid ? 'border-red-400 bg-red-50' : 'border-[#dbdbdb] bg-white'
      }`}
    />
  );
}

/** Prep minutes, committed on blur. Empty = the restaurant default. */
function PrepInput({ value, estimated, onCommit }: { value: number | undefined; estimated?: boolean; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  useEffect(() => setText(typeof value === 'number' ? String(value) : ''), [value]);
  const n = text.trim() ? Number(text) : undefined;
  const bad = n !== undefined && (!Number.isInteger(n) || n < 1 || n > 240);
  return (
    <label
      className="inline-flex items-center gap-1 rounded-md border border-[#dbdbdb] bg-white pl-2"
      title={estimated ? "Not printed on the menu — a typical time for this dish. Check it matches your kitchen." : 'Prep time (minutes)'}
    >
      <ClockIcon className="h-3.5 w-3.5 text-[#6b6b70]" aria-hidden="true" />
      <input
        aria-label="Prep time in minutes"
        inputMode="numeric"
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
        onBlur={() => !bad && n !== value && onCommit(n)}
        className={`w-9 bg-transparent py-1.5 text-right text-sm tabular-nums outline-none ${bad ? 'text-red-600' : ''}`}
      />
      <span className="pr-2 text-xs text-[#6b6b70]">
        min{estimated && <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">est.</span>}
      </span>
    </label>
  );
}

export default function DraftItemRow({
  item,
  currency,
  moveTargets,
  onChange,
  onMove,
  onRemove,
  onEdit,
}: {
  item: DraftItem;
  currency?: string;
  moveTargets: Array<{ tempId: string; name: string }>;
  onChange: (next: DraftItem) => void;
  onMove: (toCategoryTempId: string) => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const skipped = item.action === 'skip';
  const blocking = itemBlockingIssue(item);
  const variantPriced = hasVariantPrice(item);
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);

  const setAction = (action: DraftItemAction) => onChange({ ...item, action });

  return (
    <div
      className={`grid grid-cols-[auto_1fr] gap-3 border-t border-[#f0f0f0] px-4 py-3 sm:grid-cols-[auto_1fr_auto] ${
        skipped ? 'bg-[#fafafa] opacity-60' : ''
      }`}
    >
      {/* include */}
      <input
        type="checkbox"
        aria-label={`Include ${item.name || 'item'}`}
        checked={!skipped}
        onChange={(e) =>
          setAction(e.target.checked ? (item.duplicateOfItemId ? 'update' : 'create') : 'skip')
        }
        className="mt-2 h-4 w-4 accent-[#2e2e30]"
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Item name"
            value={name}
            placeholder="Item name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== item.name && onChange({ ...item, name })}
            className={`min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm font-medium outline-none focus:border-[#2e2e30] ${
              !skipped && !name.trim() ? 'border-red-400 bg-red-50' : 'border-transparent hover:border-[#dbdbdb]'
            }`}
          />
          {item.confidence === 'low' && !skipped && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              <ExclamationTriangleIcon className="h-3.5 w-3.5" /> Check
            </span>
          )}
          {item.sourcePage && <span className="text-xs text-[#9a9aa0]">p.{item.sourcePage}</span>}
        </div>

        {item.description && (
          <p className="mt-1 line-clamp-2 px-2 text-xs text-[#6b6b70]">{item.description}</p>
        )}

        {/* variations / tags / add-ons */}
        <div className="mt-2 flex flex-wrap gap-1.5 px-2">
          {item.options.map((o) => (
            <span key={o.name} className="rounded bg-[#f3f3f3] px-2 py-0.5 text-xs text-[#2e2e30]">
              {o.name}: {o.values.join(' / ')}
            </span>
          ))}
          {variantPriced && (
            <span className="rounded bg-[#f3f3f3] px-2 py-0.5 text-xs text-[#2e2e30]">
              {item.variations
                .map((v) => `${v.name} ${formatPrice(v.price, currency)}`)
                .join(' · ')}
            </span>
          )}
          {(item.modifierGroups ?? []).map((g) => (
            <span
              key={g.name}
              title={g.options.map((o) => (o.price ? `${o.name} +${o.price}` : o.name)).join(', ')}
              className="rounded bg-violet-50 px-2 py-0.5 text-xs text-violet-700"
            >
              {g.name} · {g.min > 0 ? 'required' : 'optional'} · {g.options.length} option{g.options.length === 1 ? '' : 's'}
            </span>
          ))}
          {item.tags.map((t) => (
            <span key={t} className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-xs text-[#6b6b70]">
              {t}
            </span>
          ))}
          {item.media.length > 0 && (
            <span className="text-xs text-[#6b6b70]">{item.media.length} photo(s)</span>
          )}
        </div>

        {item.addOnsNote && (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-2 text-xs text-[#6b6b70]">
            <span>
              <span className="font-medium text-[#2e2e30]">Add-ons found:</span> {item.addOnsNote}
            </span>
            <button
              type="button"
              className="underline hover:text-[#2e2e30]"
              onClick={() =>
                onChange({
                  ...item,
                  description: [item.description, `Add-ons: ${item.addOnsNote}`].filter(Boolean).join('\n'),
                  addOnsNote: undefined,
                })
              }
            >
              Add to description
            </button>
          </div>
        )}

        {!skipped && (blocking || item.issues.length > 0) && (
          <ul className="mt-2 space-y-0.5 px-2 text-xs">
            {blocking && <li className="text-red-600">• {blocking}</li>}
            {item.issues.map((i) => (
              <li key={i} className="text-amber-700">
                • {i}
              </li>
            ))}
          </ul>
        )}

        {item.duplicateOfItemId && (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
              <DocumentDuplicateIcon className="h-3.5 w-3.5" /> Already in your menu
            </span>
            <select
              aria-label="What to do with the existing item"
              value={item.action}
              onChange={(e) => setAction(e.target.value as DraftItemAction)}
              className="rounded-md border border-[#dbdbdb] bg-white px-2 py-1"
            >
              <option value="skip">Skip (keep existing)</option>
              <option value="update">Update existing item</option>
              <option value="create">Add as a new item</option>
            </select>
          </div>
        )}
      </div>

      {/* prices + actions */}
      <div className="col-span-2 flex flex-wrap items-start gap-2 sm:col-span-1 sm:justify-end">
        {variantPriced ? (
          <span className="rounded-md bg-[#f3f3f3] px-2 py-1.5 text-xs text-[#6b6b70]">Set by variations</span>
        ) : (
          <>
            <PriceInput
              ariaLabel="Price"
              value={item.price}
              placeholder="Price"
              invalid={!skipped && typeof item.price !== 'number'}
              onCommit={(price) => onChange({ ...item, price })}
            />
            <PriceInput
              ariaLabel="Compare-at price"
              value={item.compareAtPrice}
              placeholder="Compare-at"
              invalid={
                typeof item.compareAtPrice === 'number' &&
                typeof item.price === 'number' &&
                item.compareAtPrice < item.price
              }
              onCommit={(compareAtPrice) => onChange({ ...item, compareAtPrice })}
            />
          </>
        )}

        <PrepInput
          value={item.prepMinutes}
          estimated={item.prepEstimated}
          onCommit={(prepMinutes) => onChange({ ...item, prepMinutes, prepEstimated: undefined })}
        />

        {moveTargets.length > 0 && (
          <select
            aria-label="Move to category"
            value=""
            onChange={(e) => e.target.value && onMove(e.target.value)}
            className="max-w-[9rem] rounded-md border border-[#dbdbdb] bg-white px-2 py-1.5 text-xs text-[#6b6b70]"
          >
            <option value="">Move to…</option>
            {moveTargets.map((c) => (
              <option key={c.tempId} value={c.tempId}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onEdit}
          title="Edit details (variations, photos, tags)"
          className="rounded-md border border-[#dbdbdb] p-1.5 text-[#2e2e30] hover:bg-[#f6f6f6]"
        >
          <PencilSquareIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove from import"
          className="rounded-md border border-[#dbdbdb] p-1.5 text-[#6b6b70] hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
