import { useState } from 'react';
import { PlusCircleIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Add-on / choice groups editor ("Extras", "Choose your side", "Spice level").
 *   min 0            → optional
 *   min 1, max 1     → required, pick one
 *   min 0, max N     → pick up to N
 */

export type UiModifierOption = { id?: string; name: string; price: string };
export type UiModifierGroup = {
  key: string; // local React key
  id?: string;
  name: string;
  min: number;
  max: number;
  options: UiModifierOption[];
};

export type ApiModifierGroup = {
  id?: string;
  name: string;
  min: number;
  max: number;
  options: Array<{ id?: string; name: string; price: number }>;
};

let keySeq = 0;
const newKey = () => `mg-${Date.now().toString(36)}-${keySeq++}`;

export function toUiModifierGroups(groups?: ApiModifierGroup[] | null): UiModifierGroup[] {
  return (groups || []).map((g) => ({
    key: newKey(),
    id: g.id,
    name: g.name,
    min: g.min,
    max: g.max,
    options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price ? String(o.price) : '' })),
  }));
}

export function toApiModifierGroups(groups: UiModifierGroup[]): ApiModifierGroup[] {
  return groups
    .map((g) => {
      const options = g.options
        .filter((o) => o.name.trim())
        .map((o) => ({
          ...(o.id ? { id: o.id } : {}),
          name: o.name.trim(),
          price: o.price.trim() ? Number(o.price) : 0,
        }));
      const max = Math.min(Math.max(g.max, 1), Math.max(options.length, 1));
      return {
        ...(g.id ? { id: g.id } : {}),
        name: g.name.trim(),
        min: Math.min(g.min, max),
        max,
        options,
      };
    })
    .filter((g) => g.name && g.options.length);
}

/** Returns a user-facing error, or null when all groups are valid. */
export function validateModifierGroups(groups: UiModifierGroup[]): string | null {
  for (const g of groups) {
    const filled = g.options.filter((o) => o.name.trim());
    if (!g.name.trim() && !filled.length) continue; // empty group is ignored
    if (!g.name.trim()) return 'Give every add-on group a name.';
    if (!filled.length) return `Add at least one option to "${g.name}".`;
    for (const o of filled) {
      const p = o.price.trim();
      if (p && (!Number.isFinite(Number(p)) || Number(p) < 0)) {
        return `Enter a valid price for "${o.name}" in "${g.name}".`;
      }
    }
    if (g.min > filled.length) return `"${g.name}" requires more choices than it has options.`;
  }
  return null;
}

type Rule = 'optional' | 'required-one' | 'up-to' | 'exactly';

function ruleOf(g: UiModifierGroup): Rule {
  if (g.min === 0) return g.max >= Math.max(g.options.length, 1) ? 'optional' : 'up-to';
  if (g.min === 1 && g.max === 1) return 'required-one';
  return 'exactly';
}

function ruleLabel(g: UiModifierGroup): string {
  const n = g.options.filter((o) => o.name.trim()).length;
  if (g.min === 0 && g.max >= n) return 'Optional';
  if (g.min === 0) return `Optional · up to ${g.max}`;
  if (g.min === 1 && g.max === 1) return 'Required · pick 1';
  if (g.min === g.max) return `Required · pick ${g.min}`;
  return `Required · pick ${g.min}–${g.max}`;
}

const PRESETS: Array<{ label: string; group: Omit<UiModifierGroup, 'key'> }> = [
  {
    label: 'Extras',
    group: {
      name: 'Extras',
      min: 0,
      max: 3,
      options: [
        { name: 'Extra cheese', price: '' },
        { name: 'Extra sauce', price: '' },
        { name: '', price: '' },
      ],
    },
  },
  {
    label: 'Choose a side',
    group: {
      name: 'Choose a side',
      min: 1,
      max: 1,
      options: [
        { name: 'Fries', price: '' },
        { name: 'Salad', price: '' },
        { name: '', price: '' },
      ],
    },
  },
  {
    label: 'Spice level',
    group: {
      name: 'Spice level',
      min: 1,
      max: 1,
      options: [
        { name: 'Mild', price: '' },
        { name: 'Medium', price: '' },
        { name: 'Hot', price: '' },
      ],
    },
  },
  {
    label: 'Drink',
    group: {
      name: 'Choose a drink',
      min: 0,
      max: 1,
      options: [
        { name: 'Soft drink', price: '' },
        { name: 'Water', price: '' },
        { name: '', price: '' },
      ],
    },
  },
  { label: 'Custom', group: { name: '', min: 0, max: 1, options: [{ name: '', price: '' }] } },
];

function GroupEditor({
  group,
  onChange,
  onRemove,
}: {
  group: UiModifierGroup;
  onChange: (g: UiModifierGroup) => void;
  onRemove: () => void;
}) {
  const optionCount = Math.max(group.options.filter((o) => o.name.trim()).length, 1);
  const rule = ruleOf(group);

  const setRule = (r: Rule) => {
    if (r === 'optional') onChange({ ...group, min: 0, max: Math.max(group.options.length, 1) });
    else if (r === 'required-one') onChange({ ...group, min: 1, max: 1 });
    else if (r === 'up-to') onChange({ ...group, min: 0, max: Math.min(Math.max(group.max, 1), optionCount) });
    else onChange({ ...group, min: Math.max(group.min, 1), max: Math.max(group.max, group.min, 1) });
  };

  const setOption = (i: number, patch: Partial<UiModifierOption>) =>
    onChange({ ...group, options: group.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <div className="rounded-lg border border-[#e5e5e5] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Add-on group name"
          value={group.name}
          placeholder="Group name (e.g. Extras)"
          onChange={(e) => onChange({ ...group, name: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-[#dbdbdb] px-3 py-2 text-sm font-medium outline-none focus:border-[#2e2e30]"
        />
        <select
          aria-label="Selection rule"
          value={rule}
          onChange={(e) => setRule(e.target.value as Rule)}
          className="rounded-md border border-[#dbdbdb] bg-white px-2 py-2 text-sm"
        >
          <option value="optional">Optional (any)</option>
          <option value="up-to">Optional, up to…</option>
          <option value="required-one">Required, pick 1</option>
          <option value="exactly">Required, pick…</option>
        </select>
        {rule === 'up-to' && (
          <input
            aria-label="Maximum choices"
            type="number"
            min={1}
            max={optionCount}
            value={group.max}
            onChange={(e) => onChange({ ...group, max: Math.max(1, Number(e.target.value) || 1) })}
            className="w-16 rounded-md border border-[#dbdbdb] px-2 py-2 text-sm"
          />
        )}
        {rule === 'exactly' && (
          <span className="flex items-center gap-1 text-sm text-[#6b6b70]">
            <input
              aria-label="Minimum choices"
              type="number"
              min={1}
              value={group.min}
              onChange={(e) => {
                const min = Math.max(1, Number(e.target.value) || 1);
                onChange({ ...group, min, max: Math.max(group.max, min) });
              }}
              className="w-14 rounded-md border border-[#dbdbdb] px-2 py-2 text-sm"
            />
            to
            <input
              aria-label="Maximum choices"
              type="number"
              min={group.min}
              value={group.max}
              onChange={(e) => onChange({ ...group, max: Math.max(group.min, Number(e.target.value) || 1) })}
              className="w-14 rounded-md border border-[#dbdbdb] px-2 py-2 text-sm"
            />
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove add-on group"
          className="rounded-md p-2 text-[#6b6b70] hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {group.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label="Option name"
              value={o.name}
              placeholder="Option (e.g. Extra cheese)"
              onChange={(e) => setOption(i, { name: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-[#dbdbdb] px-3 py-1.5 text-sm outline-none focus:border-[#2e2e30]"
            />
            <div className="flex items-center rounded-md border border-[#dbdbdb] focus-within:border-[#2e2e30]">
              <span className="pl-2 text-xs text-[#6b6b70]">+</span>
              <input
                aria-label="Option price"
                inputMode="decimal"
                value={o.price}
                placeholder="0"
                onChange={(e) => setOption(i, { price: e.target.value })}
                className="w-20 rounded-md px-2 py-1.5 text-sm tabular-nums outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="Remove option"
              onClick={() => onChange({ ...group, options: group.options.filter((_, j) => j !== i) })}
              className="rounded-md p-1.5 text-[#9a9aa0] hover:text-red-600"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...group,
              options: [...group.options, { name: '', price: '' }],
              // "Optional (any)" keeps allowing every option
              ...(rule === 'optional' ? { max: group.options.length + 1 } : {}),
            })
          }
          className="inline-flex items-center gap-1 text-sm text-[#6b6b70] hover:text-[#2e2e30]"
        >
          <PlusIcon className="h-4 w-4" /> Add option
        </button>
      </div>
      <p className="mt-2 text-xs text-[#9a9aa0]">{ruleLabel(group)} · leave price empty for free choices</p>
    </div>
  );
}

export default function AddOns({
  value,
  onChange,
  error,
}: {
  value: UiModifierGroup[];
  onChange: (next: UiModifierGroup[]) => void;
  error?: string | null;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-medium text-[#2e2e30]">Add-ons & choices</label>
        {value.length > 0 && <span className="text-xs text-[#6b6b70]">{value.length} group(s)</span>}
      </div>
      <p className="mb-3 text-xs text-[#6b6b70]">
        Extras customers can add (paid or free), or choices they must make — like a side or spice level.
      </p>

      <div className="space-y-3">
        {value.map((g) => (
          <GroupEditor
            key={g.key}
            group={g}
            onChange={(next) => onChange(value.map((x) => (x.key === g.key ? next : x)))}
            onRemove={() => onChange(value.filter((x) => x.key !== g.key))}
          />
        ))}
      </div>

      {picking ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange([
                  ...value,
                  { ...p.group, key: newKey(), options: p.group.options.map((o) => ({ ...o })) },
                ]);
                setPicking(false);
              }}
              className="rounded-full border border-[#dbdbdb] bg-white px-3 py-1.5 text-sm text-[#2e2e30] hover:bg-[#f6f6f6]"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="px-2 text-sm text-[#6b6b70] hover:text-[#2e2e30]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-dashed border-[#cfcfcf] px-3 py-2 text-sm font-medium text-[#2e2e30] hover:bg-[#f6f6f6]"
        >
          <PlusCircleIcon className="h-5 w-5" /> Add add-on group
        </button>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
