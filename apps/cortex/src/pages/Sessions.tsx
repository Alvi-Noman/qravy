// apps/cortex/src/pages/Sessions.tsx — guest visits across every restaurant: where, how long, what they did.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type SessionItem, type TenantRow } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, Td, Th, fmt } from '../components/ui';

export function SessionsTable({ items, hideRestaurant }: { items: SessionItem[]; hideRestaurant?: boolean }) {
  if (!items.length) return <Empty>No guest sessions match.</Empty>;
  return (
    <div className="-m-5 overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-stone-100 bg-stone-50/60">
          <tr>
            <Th>Started</Th>
            {!hideRestaurant && <Th>Restaurant</Th>}
            <Th>Branch</Th>
            <Th>Where</Th>
            <Th right>Time</Th>
            <Th right>Pages</Th>
            <Th right>AI turns</Th>
            <Th right>Added</Th>
            <Th>Outcome</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {items.map((s) => (
            <tr key={s.vid} className="hover:bg-stone-50">
              <Td>
                <Link to={`/sessions/${encodeURIComponent(s.vid)}`} className="font-medium text-stone-900 hover:underline">
                  {fmt.time(s.startedAt)}
                </Link>
              </Td>
              {!hideRestaurant && (
                <Td>
                  <Link to={`/restaurants/${s.tenantId}`} className="hover:underline">
                    {s.restaurant}
                  </Link>
                </Td>
              )}
              <Td>{s.branch ?? '—'}</Td>
              <Td>
                {s.channel === 'dine-in' ? `Table ${s.table ?? '?'}` : 'Online'}
                {s.scanned && <span className="ml-1.5"><Badge>QR</Badge></span>}
                <span className="ml-1.5 text-[11px] text-stone-400">{s.device}</span>
              </Td>
              <Td right>{fmt.min(s.minutes)}</Td>
              <Td right>{s.pageViews}</Td>
              <Td right>{s.aiTurns}</Td>
              <Td right>
                {s.itemsAdded}
                {s.suggestionsAdded > 0 && <span className="text-[11px] text-stone-500"> ({s.suggestionsAdded} suggested)</span>}
              </Td>
              <Td>
                {s.ordered ? (
                  <Badge tone="good">ordered{s.orders[0]?.orderNumber ? ` #${s.orders[0].orderNumber}` : ''}</Badge>
                ) : s.checkout ? (
                  <Badge tone="warn">left at checkout</Badge>
                ) : s.aiTurns > 0 ? (
                  <Badge tone="info">talked, no order</Badge>
                ) : (
                  <Badge>browsed</Badge>
                )}
                {s.calls > 0 && <span className="ml-1"><Badge>called staff</Badge></span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Sessions() {
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(7);
  const tenant = params.get('tenant') ?? '';
  const channel = params.get('channel') ?? '';
  const only = params.get('only') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const qs = new URLSearchParams({ days: String(days), limit: '200', ...(tenant ? { tenant } : {}), ...(channel ? { channel } : {}), ...(only ? { only } : {}) });
  const q = useQuery({ queryKey: ['sessions', qs.toString()], queryFn: () => api<{ items: SessionItem[]; total: number }>(`/sessions?${qs}`) });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">Guest sessions</h1>
          <p className="text-[13px] text-stone-500">One row per guest visit. Open one to see every step and what the AI waiter heard and said.</p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <select value={tenant} onChange={(e) => set('tenant', e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">All restaurants</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={channel} onChange={(e) => set('channel', e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">Dine-in and online</option>
          <option value="dine-in">Dine-in</option>
          <option value="online">Online</option>
        </select>
        <select value={only} onChange={(e) => set('only', e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">Every session</option>
          <option value="ordered">Ordered</option>
          <option value="engaged">Talked to the AI</option>
          <option value="abandoned">Left at checkout</option>
          <option value="scanned">Came from a QR code</option>
        </select>
        {q.data && <span className="text-[12px] text-stone-500">{q.data.total} sessions{q.data.total > q.data.items.length ? ` · newest ${q.data.items.length} shown` : ''}</span>}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <Card>
          <SessionsTable items={q.data.items} />
        </Card>
      )}
    </div>
  );
}
