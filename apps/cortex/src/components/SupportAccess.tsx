// apps/cortex/src/components/SupportAccess.tsx — Qravy support access for one restaurant (auth-service supportRoutes):
// open its dashboard as an admin of it — a 1-hour session of its own, shown as "Qravy support" on every screen there —
// and the history: who opened it, when, why, and what was changed. A live session can be ended from here.
import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Card, fmt } from './ui';

type Session = {
  id: string;
  by: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedHow: string | null;
  active: boolean;
  changes: number;
  actions?: Array<{ at: string; method: string; path: string }>;
};

/** The button: opens the restaurant's dashboard in a new tab, signed in as Qravy support. */
export function OpenDashboardButton({ tenantId, name }: { tenantId: string; name: string }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setBusy(true);
    setError('');
    // the tab is opened now (inside the click), so the browser doesn't block it as a pop-up; the link comes after
    const tab = window.open('about:blank', '_blank');
    try {
      const r = await api<{ url: string }>(`/restaurants/${tenantId}/support-session`, { method: 'POST', body: JSON.stringify({ reason }) });
      if (tab) tab.location.href = r.url;
      else window.location.href = r.url;
      setAsking(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['support-sessions', tenantId] });
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="rounded-md bg-stone-900 px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
        Open dashboard as admin
      </button>
    );
  }
  return (
    <div className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-3 text-[13px] shadow-sm">
      <div className="font-medium text-stone-900">Open {name}’s dashboard as an admin</div>
      <p className="mt-0.5 text-stone-500">
        A 1-hour session, marked “Qravy support” on every screen. Everything is logged and the owner can see it. You can set up their plan and
        payment and add or remove admins; the owner’s own sign-ins stay locked.
      </p>
      <input
        autoFocus
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && void open()}
        placeholder="Why? (optional) — e.g. fixing their menu prices"
        className="mt-2 w-full rounded-md border border-stone-300 px-2 py-1.5"
      />
      {error && <p className="mt-1.5 text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2.5 py-1.5 text-stone-600 hover:bg-stone-50">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={() => void open()} className="rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {busy ? 'Opening…' : 'Open dashboard'}
        </button>
      </div>
    </div>
  );
}

/** The history: every support session in this restaurant, newest first. */
export function SupportHistory({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['support-sessions', tenantId],
    queryFn: () => api<{ items: Session[] }>(`/restaurants/${tenantId}/support-sessions`),
    refetchInterval: 30_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const end = async (sid: string) => {
    await api(`/support-sessions/${sid}/end`, { method: 'POST' });
    await qc.invalidateQueries({ queryKey: ['support-sessions', tenantId] });
  };
  const items = q.data?.items ?? [];
  return (
    <Card title="Qravy support access" right={<span className="text-[12px] text-stone-500">who opened this restaurant’s dashboard, and what they changed</span>}>
      {!items.length ? (
        <p className="text-[13px] text-stone-500">No support sessions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="pb-2 pr-3 font-semibold">When</th>
                <th className="pb-2 pr-3 font-semibold">Who</th>
                <th className="pb-2 pr-3 font-semibold">Why</th>
                <th className="pb-2 pr-3 font-semibold">Changes</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-t border-stone-100 align-top">
                    <td className="py-2 pr-3 text-stone-700">
                      {fmt.date(s.startedAt)} {new Date(s.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      <div className="text-[11px] text-stone-400">
                        {s.active ? `until ${new Date(s.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : s.endedHow ?? 'ended'}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-stone-700">{s.by}</td>
                    <td className="py-2 pr-3 text-stone-600">{s.reason || '—'}</td>
                    <td className="py-2 pr-3">
                      {s.changes ? (
                        <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="text-stone-800 underline">
                          {s.changes} change{s.changes === 1 ? '' : 's'}
                        </button>
                      ) : (
                        <span className="text-stone-400">none</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {s.active ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge tone="good">live</Badge>
                          <button type="button" onClick={() => void end(s.id)} className="rounded-md px-2 py-1 text-red-700 hover:bg-red-50">
                            End now
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr className="bg-stone-50/70">
                      <td colSpan={5} className="px-3 py-2">
                        <ul className="space-y-0.5 font-mono text-[12px] text-stone-600">
                          {(s.actions ?? []).map((a, i) => (
                            <li key={i}>
                              {new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} {a.method}{' '}
                              {a.path.replace(/^\/api\/v1/, '')}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
