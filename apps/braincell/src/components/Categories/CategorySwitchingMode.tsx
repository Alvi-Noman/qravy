// Categories → how categories turn on and off: by their serving hours (Breakfast 7–11…), or only by their switch.
// One restaurant-wide setting (tenant.categoryHoursMode) — the menu, checkout and the AI waiter all follow it.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClockIcon, HandRaisedIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { toastError, toastSuccess } from '../Toaster';

export type CategoryHoursMode = 'auto' | 'manual';

export function useCategoryHoursMode(): CategoryHoursMode {
  const { data: tenant } = useTenant();
  return (tenant as { categoryHoursMode?: CategoryHoursMode } | undefined)?.categoryHoursMode === 'manual' ? 'manual' : 'auto';
}

const OPTIONS: Array<{ value: CategoryHoursMode; label: string; icon: typeof ClockIcon }> = [
  { value: 'auto', label: 'Automatically', icon: ClockIcon },
  { value: 'manual', label: 'By hand', icon: HandRaisedIcon },
];

export default function CategorySwitchingMode() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const saved = useCategoryHoursMode();
  const [pending, setPending] = useState<CategoryHoursMode | null>(null);
  const mode = pending ?? saved;

  const choose = async (next: CategoryHoursMode) => {
    if (next === mode || pending) return;
    setPending(next);
    try {
      await updateTenant({ categoryHoursMode: next }, token as string);
      await queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'tenant' });
      toastSuccess(
        next === 'manual'
          ? 'Categories now stay on until you switch them off'
          : 'Categories now turn on and off by their serving hours'
      );
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not change how categories switch');
    } finally {
      setPending(null);
    }
  };

  return (
    <section
      aria-label="How categories turn on and off"
      className="flex flex-col gap-3 rounded-lg border border-[#ececec] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-[#2e2e30]">Turn categories on and off</div>
        <p className="mt-0.5 text-[12px] leading-5 text-[#6b6b70]">
          {mode === 'auto'
            ? 'Categories with serving hours (e.g. Breakfast 7–11am) switch on and off by themselves. You can still switch any off below.'
            : 'Serving hours are ignored — a category stays on until you switch it off below, and back on when you switch it on.'}
        </p>
      </div>
      <div role="radiogroup" aria-label="Turn categories on and off" className="flex shrink-0 rounded-lg border border-[#e2e2e2] bg-[#f6f6f7] p-1">
        {OPTIONS.map((o) => {
          const on = mode === o.value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!!pending}
              onClick={() => choose(o.value)}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition sm:flex-none ${
                on ? 'bg-white font-semibold text-[#2e2e30] shadow-sm ring-1 ring-[#e2e2e2]' : 'text-[#5b5b5d] hover:text-[#2e2e30]'
              } disabled:opacity-70`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {o.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
