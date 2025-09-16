import React from 'react';

export function PlanIntervalSwitch({
  value,
  onChange,
  savingsLabel = 'Save 15%',
}: {
  value: 'monthly' | 'yearly';
  onChange: (v: 'monthly' | 'yearly') => void;
  savingsLabel?: string;
}) {
  const active = (v: 'monthly' | 'yearly') => value === v;
  return (
    <div className="inline-flex items-center rounded-full border border-[#e5e5e5] bg-white p-1">
      <button
        type="button"
        aria-pressed={active('monthly')}
        onClick={() => onChange('monthly')}
        className={`rounded-full px-3 py-1.5 text-[12px] transition ${
          active('monthly') ? 'bg-[#2e2e30] font-medium text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
        }`}
      >
        Pay monthly
      </button>
      <div className="ml-2 inline-flex items-center gap-2">
        <button
          type="button"
          aria-pressed={active('yearly')}
          onClick={() => onChange('yearly')}
          className={`rounded-full px-3 py-1.5 text-[12px] transition ${
            active('yearly') ? 'bg-[#2e2e30] font-medium text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          Pay yearly
        </button>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          {savingsLabel}
        </span>
      </div>
    </div>
  );
}