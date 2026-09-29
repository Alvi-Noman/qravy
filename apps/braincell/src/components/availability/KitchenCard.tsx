/**
 * Settings → Hours & availability → Kitchen: the two numbers behind wait-time estimates.
 *   - default prep time: used for dishes that have no prep time of their own
 *   - orders cooked at once: how many orders the kitchen works on side by side (more = shorter queue)
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClockIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { updateTenant } from '../../api/tenant';
import { DEFAULT_KITCHEN, useKitchenSettings } from '../../hooks/useKitchenSettings';
import { toastError, toastSuccess } from '../Toaster';

function Stepper({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n || min)));
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md border border-[#e2e2e2]">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        className="px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        aria-label={`Less (${suffix})`}
      >
        −
      </button>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ''))))}
        className="w-14 border-x border-[#e2e2e2] py-2 text-center text-sm tabular-nums outline-none"
      />
      <span className="flex items-center bg-slate-50 px-2 text-xs text-slate-500">{suffix}</span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        className="border-l border-[#e2e2e2] px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        aria-label={`More (${suffix})`}
      >
        +
      </button>
    </div>
  );
}

export default function KitchenCard() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const saved = useKitchenSettings();
  const [prep, setPrep] = useState(saved.defaultPrepMinutes);
  const [parallel, setParallel] = useState(saved.parallelOrders);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrep(saved.defaultPrepMinutes);
    setParallel(saved.parallelOrders);
  }, [saved.defaultPrepMinutes, saved.parallelOrders]);

  const dirty = prep !== saved.defaultPrepMinutes || parallel !== saved.parallelOrders;

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ kitchen: { defaultPrepMinutes: prep, parallelOrders: parallel } }, token as string);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Kitchen settings saved');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save kitchen settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="kitchen" className="scroll-mt-20 rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
        <ClockIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        Kitchen & wait times
      </div>
      <p className="mt-1 text-[12px] text-slate-500">
        Guests see how long their food will take — on the menu, in their cart, and as a live countdown after they
        order. The estimate uses each dish’s prep time and how busy your kitchen is right now.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label className="text-[12px] font-medium text-slate-700" htmlFor="kitchen-prep">
            Default prep time
          </label>
          <Stepper id="kitchen-prep" value={prep} onChange={setPrep} min={1} max={240} suffix="min" />
          <span className="text-[12px] text-slate-500">
            For dishes without their own prep time (set it on each menu item for better estimates).
          </span>
        </div>
        <div className="grid gap-1.5">
          <label className="text-[12px] font-medium text-slate-700" htmlFor="kitchen-parallel">
            Orders your kitchen cooks at once
          </label>
          <Stepper id="kitchen-parallel" value={parallel} onChange={setParallel} min={1} max={50} suffix="orders" />
          <span className="text-[12px] text-slate-500">
            With more orders than this open, new orders wait for a free spot — guests see the longer time.
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setPrep(DEFAULT_KITCHEN.defaultPrepMinutes);
              setParallel(DEFAULT_KITCHEN.parallelOrders);
            }}
            className="text-xs text-slate-500 underline-offset-2 hover:underline"
          >
            Use defaults ({DEFAULT_KITCHEN.defaultPrepMinutes} min, {DEFAULT_KITCHEN.parallelOrders} orders)
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
