// apps/tastebud/src/components/ModifierPicker.tsx
/**
 * Customer-facing add-on / choice groups ("Extras", "Choose your side").
 *   max 1  → radio-style single choice
 *   max >1 → checkboxes, limited to `max`
 */
import React from 'react';
import type { CartModifier } from '../context/CartContext';

export type ModifierGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: Array<{ id: string; name: string; price: number }>;
};

/** groupId → chosen optionIds */
export type ModifierPicks = Record<string, string[]>;

const BDT = new Intl.NumberFormat('en-BD');
const formatBDT = (n: number) => `৳ ${BDT.format(n)}`;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function groupRuleText(g: ModifierGroup): string {
  if (g.min === 0) return g.max >= g.options.length ? 'Optional' : `Optional · up to ${g.max}`;
  if (g.min === g.max) return g.min === 1 ? 'Required · choose 1' : `Required · choose ${g.min}`;
  return `Required · choose ${g.min}–${g.max}`;
}

/** Returns an error per group that doesn't meet its min/max. */
export function validatePicks(groups: ModifierGroup[], picks: ModifierPicks): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const g of groups) {
    const n = (picks[g.id] ?? []).length;
    if (n < g.min) errors[g.id] = g.min === 1 ? 'Please choose one' : `Please choose at least ${g.min}`;
    else if (n > g.max) errors[g.id] = `Choose up to ${g.max}`;
  }
  return errors;
}

export function picksToModifiers(groups: ModifierGroup[], picks: ModifierPicks): CartModifier[] {
  const out: CartModifier[] = [];
  for (const g of groups) {
    for (const optionId of picks[g.id] ?? []) {
      const o = g.options.find((x) => x.id === optionId);
      if (o) out.push({ groupId: g.id, groupName: g.name, optionId: o.id, name: o.name, price: o.price || 0 });
    }
  }
  return out;
}

export default function ModifierPicker({
  groups,
  picks,
  onChange,
  errors,
}: {
  groups: ModifierGroup[];
  picks: ModifierPicks;
  onChange: (next: ModifierPicks) => void;
  errors?: Record<string, string>;
}) {
  const toggle = (g: ModifierGroup, optionId: string) => {
    const cur = picks[g.id] ?? [];
    let next: string[];
    if (g.max === 1) {
      // single choice: select (or deselect when optional)
      next = cur[0] === optionId && g.min === 0 ? [] : [optionId];
    } else if (cur.includes(optionId)) {
      next = cur.filter((x) => x !== optionId);
    } else {
      if (cur.length >= g.max) return;
      next = [...cur, optionId];
    }
    onChange({ ...picks, [g.id]: next });
  };

  return (
    <div className="mt-5 space-y-4">
      {groups.map((g) => {
        const chosen = picks[g.id] ?? [];
        const err = errors?.[g.id];
        const single = g.max === 1;
        const full = !single && chosen.length >= g.max;
        return (
          <section
            key={g.id}
            data-modifier-group={g.id}
            aria-label={g.name}
            className={cx(
              'rounded-[22px] border bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:px-5',
              err ? 'border-[#FA2851]' : 'border-gray-100'
            )}
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h5 className="text-[15px] font-semibold text-neutral-900">{g.name}</h5>
              <span
                className={cx(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  g.min > 0 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                )}
              >
                {groupRuleText(g)}
              </span>
            </div>
            {err && <p className="mb-1 text-[12px] font-medium text-[#FA2851]">{err}</p>}

            <div role={single ? 'radiogroup' : 'group'} className="divide-y divide-neutral-100">
              {g.options.map((o) => {
                const checked = chosen.includes(o.id);
                const disabled = !checked && full;
                return (
                  <label
                    key={o.id}
                    className={cx(
                      'flex cursor-pointer items-center justify-between gap-3 py-3',
                      disabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name={`mod-${g.id}`}
                        className="h-[18px] w-[18px] accent-black"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(g, o.id)}
                        onClick={(e) => {
                          // allow un-selecting an optional single choice
                          if (single && checked && g.min === 0) {
                            e.preventDefault();
                            toggle(g, o.id);
                          }
                        }}
                      />
                      <span className="text-[15px] text-neutral-900">{o.name}</span>
                    </span>
                    <span className="text-[14px] text-neutral-600">
                      {o.price ? `+ ${formatBDT(o.price)}` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
