// apps/braincell/src/pages/ServiceRequests.tsx — Service Requests: guests at their table calling for staff ("Call
// waiter", the bill, water, clean the table — from the button or by asking the AI waiter). They arrive live, the
// order chime plays (Sound on) and the counter buzzer rings; staff tap On my way (the guest sees it) → Done.
// Waiting calls first; the ones done in the last hour below.
import { useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, BellAlertIcon, BellSlashIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import PageFrame, { HEADER_BUTTON, LiveBadge, Segmented } from '../components/PageFrame';
import { useOrdersLive } from '../context/OrdersLiveContext';
import { usePermissions } from '../context/PermissionsContext';
import { useScope } from '../context/ScopeContext';
import { useTenant } from '../hooks/useTenant';
import { useBuzzerAlert } from '../hooks/useBuzzerAlert';
import { useBranchLabel } from '../hooks/useBranchLabel';
import { toastError } from '../components/Toaster';
import { SERVICE_KIND_LABEL, type ServiceRequest } from '../api/serviceRequests';

type View = 'waiting' | 'done';

const STATUS: Record<ServiceRequest['status'], { label: string; cls: string }> = {
  open: { label: 'Waiting', cls: 'bg-pink-50 text-pink-700 ring-pink-200' },
  acknowledged: { label: 'On the way', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  resolved: { label: 'Done', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

function waited(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export default function ServiceRequests() {
  const { calls, openCallCount, connected, soundOn, setSoundOn, soundBlocked, refresh, loading, setCallStatus } = useOrdersLive();
  const { has } = usePermissions();
  const canUpdate = has('orders:update');
  const { activeLocationId } = useScope();
  const { data: tenant } = useTenant();
  const { active: buzzerActive, dismiss: dismissBuzzer } = useBuzzerAlert(
    (tenant as { subdomain?: string } | undefined)?.subdomain,
    activeLocationId
  );
  const branchOf = useBranchLabel();
  const [view, setView] = useState<View>('waiting');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const waiting = useMemo(() => calls.filter((c) => c.status !== 'resolved'), [calls]);
  const done = useMemo(() => calls.filter((c) => c.status === 'resolved'), [calls]);
  const list = view === 'waiting' ? waiting : done;

  const move = async (c: ServiceRequest, to: 'acknowledged' | 'resolved') => {
    setBusy(c.id);
    try {
      await setCallStatus(c.id, to);
    } catch {
      toastError('Could not update the call');
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageFrame
      title="Service Requests"
      badge={
        <>
          <LiveBadge connected={connected} />
          {openCallCount > 0 && (
            <span className="rounded-full bg-pink-500 px-2 py-0.5 text-xs font-semibold text-white">{openCallCount} waiting</span>
          )}
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => setSoundOn(!soundOn)} aria-pressed={soundOn} className={HEADER_BUTTON}>
            {soundOn ? <BellAlertIcon className="h-4 w-4" /> : <BellSlashIcon className="h-4 w-4" />}
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
          <button type="button" onClick={() => void refresh()} className={HEADER_BUTTON} aria-label="Refresh">
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </>
      }
    >
      {soundBlocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <BellAlertIcon className="h-4 w-4 shrink-0" />
          Click anywhere on this page so table calls can ring — the browser keeps sound off until you do.
        </div>
      )}
      {buzzerActive && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
            <span className="text-sm font-medium text-amber-800">Counter buzzer is ringing — a table is calling, or a new order</span>
          </div>
          <button
            type="button"
            onClick={() => void dismissBuzzer()}
            className="shrink-0 whitespace-nowrap rounded-md bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200 active:scale-95"
          >
            Silence buzzer
          </button>
        </div>
      )}

      <Segmented<View>
        label="Which calls"
        value={view}
        onChange={setView}
        options={[
          { id: 'waiting', label: <>Waiting <span className="ml-1 text-xs text-[#9a9aa0]">{waiting.length}</span></> },
          { id: 'done', label: <>Done · last hour <span className="ml-1 text-xs text-[#9a9aa0]">{done.length}</span></> },
        ]}
      />

      {list.length ? (
        // one row per call — table + request on the left, how long + status, the buttons on the right; on a narrow
        // screen the buttons drop below instead of being cut off
        <ul className="divide-y divide-[#f0f0f0] overflow-hidden rounded-lg border border-[#ececec] bg-white">
          {list.map((c) => {
            const long = c.status === 'open' && now - new Date(c.lastCalledAt).getTime() >= 3 * 60000;
            return (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 ${c.status === 'open' ? 'bg-pink-50/40' : ''}`}>
                <div className="flex min-w-[200px] flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-[#ececec]">
                    <BellAlertIcon className={`h-5 w-5 ${c.status === 'open' ? 'animate-pulse text-pink-500' : 'text-slate-400'}`} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold text-[#2e2e30]">
                      <span className="whitespace-nowrap">Table {c.table}</span>
                      {!c.tableVerified && (
                        <span title="The guest typed this table number instead of scanning its QR code — check it's them">
                          <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" aria-label="Table not verified" />
                        </span>
                      )}
                      {branchOf(c.locationId) && (
                        <span className="rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-700">{branchOf(c.locationId)}</span>
                      )}
                      {c.calls > 1 && c.status !== 'resolved' && (
                        <span className="rounded bg-pink-100 px-1.5 text-[11px] font-semibold text-pink-700">called {c.calls}×</span>
                      )}
                    </div>
                    <div className="text-sm text-[#2e2e30]">
                      {SERVICE_KIND_LABEL[c.kind]}
                      {c.note ? <span className="text-[#6b6b70]"> — {c.note}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                  <span className={`whitespace-nowrap text-xs ${long ? 'font-semibold text-red-600' : 'text-[#6b6b70]'}`}>{waited(c.lastCalledAt, now)}</span>
                  {c.status === 'acknowledged' && c.acknowledgedBy && <span className="text-xs text-[#9a9aa0]">by {c.acknowledgedBy}</span>}
                </div>
                {canUpdate && c.status !== 'resolved' && (
                  <div className="flex gap-2">
                    {c.status === 'open' && (
                      <button
                        type="button"
                        disabled={busy === c.id}
                        onClick={() => void move(c, 'acknowledged')}
                        className="whitespace-nowrap rounded-md bg-[#2e2e30] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
                      >
                        On my way
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => void move(c, 'resolved')}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[#cecece] bg-white px-3 py-1.5 text-sm text-[#2e2e30] hover:bg-[#f5f5f5] disabled:opacity-50"
                    >
                      <CheckIcon className="h-4 w-4" /> Done
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e2e2e2] bg-white px-6 py-16 text-center">
          <BellAlertIcon className="mb-3 h-10 w-10 text-slate-300" />
          <div className="font-semibold text-[#2e2e30]">{view === 'waiting' ? 'No table is calling' : 'Nothing done in the last hour'}</div>
          <p className="mt-1 max-w-sm text-sm text-[#6b6b70]">
            Guests at a table can tap “Call waiter” (or ask the AI waiter for the bill, water…). Calls appear here instantly, the chime plays and the
            counter buzzer rings.
          </p>
        </div>
      )}
    </PageFrame>
  );
}
