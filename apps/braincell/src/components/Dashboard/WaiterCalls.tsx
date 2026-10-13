import { useBranchLabel } from '../../hooks/useBranchLabel';
import { BellAlertIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { toastError } from '../Toaster';
import { useOrdersLiveOptional } from '../../context/OrdersLiveContext';
import { usePermissions } from '../../context/PermissionsContext';
import { SERVICE_KIND_LABEL, type ServiceRequest } from '../../api/serviceRequests';

const CHIP: Record<ServiceRequest['status'], { label: string; cls: string }> = {
  open: { label: 'Waiting', cls: 'bg-pink-50 text-pink-600 border-pink-200' },
  acknowledged: { label: 'On the way', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  resolved: { label: 'Done', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/**
 * Guests calling for staff from their table ("Call waiter" on the dine-in pages), live.
 * Staff tap On my way (the guest sees it) → Done. `hideWhenEmpty`: nothing at all when no table is waiting
 * (the Orders page shows it only while there's something to answer).
 */
export default function WaiterCalls({ hideWhenEmpty = false, limit = 8 }: { hideWhenEmpty?: boolean; limit?: number }) {
  const live = useOrdersLiveOptional();
  const { has } = usePermissions();
  const canUpdate = has('orders:update');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const branchOf = useBranchLabel();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const all = live?.calls ?? [];
  const calls = hideWhenEmpty ? all.filter((c) => c.status !== 'resolved') : all.slice(0, limit);
  if (hideWhenEmpty && !calls.length) return null;

  const move = async (c: ServiceRequest, to: 'acknowledged' | 'resolved') => {
    if (!live) return;
    setBusy(c.id);
    try {
      await live.setCallStatus(c.id, to);
    } catch {
      toastError('Could not update the call');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-[#ececec] bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center justify-between font-semibold text-[#2e2e30]">
        Waiter Calls
        {!!live?.openCallCount && (
          <span className="rounded-full bg-pink-500 px-2 py-0.5 text-xs font-semibold text-white">{live.openCallCount} waiting</span>
        )}
      </h3>
      {calls.length ? (
        <ul className="divide-y divide-[#f0f0f0]">
          {calls.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-50 ring-1 ring-[#ececec]">
                  <BellAlertIcon className={`h-5 w-5 ${c.status === 'open' ? 'animate-pulse text-pink-500' : 'text-slate-400'}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-[#2e2e30]">
                    Table {c.table}
                    {branchOf(c.locationId) && (
                      <span className="rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-700">{branchOf(c.locationId)}</span>
                    )}
                    {!c.tableVerified && (
                      <span title="The guest typed this table number instead of scanning its QR code — check it's them">
                        <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" aria-label="Table not verified" />
                      </span>
                    )}
                    {c.calls > 1 && c.status !== 'resolved' && (
                      <span className="rounded bg-pink-100 px-1.5 text-[11px] font-semibold text-pink-700">called {c.calls}×</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-[#6b6b70]">
                    {SERVICE_KIND_LABEL[c.kind]}
                    {c.note ? ` — ${c.note}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-md border px-2 py-1 text-xs ${CHIP[c.status].cls}`}>{CHIP[c.status].label}</span>
                {canUpdate && c.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void move(c, 'acknowledged')}
                    className="rounded-md border border-[#cecece] px-2 py-1 text-xs text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-50"
                  >
                    On my way
                  </button>
                )}
                {canUpdate && c.status !== 'resolved' && (
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void move(c, 'resolved')}
                    className="inline-flex items-center gap-1 rounded-md border border-[#cecece] px-2 py-1 text-xs text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-50"
                  >
                    <CheckIcon className="h-3.5 w-3.5" /> Done
                  </button>
                )}
                <span className="text-xs text-[#9ca3af]">{ago(c.lastCalledAt, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-xs text-[#9a9aa0]">
          No calls right now. Guests at a table can tap “Call waiter” to call staff.
        </p>
      )}
    </div>
  );
}
