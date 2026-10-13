// apps/cortex/src/pages/Orders.tsx — orders across every restaurant, newest first.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type OrderItem, type TenantRow } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, Td, Th, fmt } from '../components/ui';

export default function Orders() {
  const [days, setDays] = useState(7);
  const [tenant, setTenant] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const qs = new URLSearchParams({ days: String(days), limit: '300', ...(tenant ? { tenant } : {}), ...(channel ? { channel } : {}), ...(status ? { status } : {}) });
  const q = useQuery({ queryKey: ['orders', qs.toString()], queryFn: () => api<{ items: OrderItem[] }>(`/orders?${qs}`), refetchInterval: 30_000 });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">Orders</h1>
          <p className="text-[13px] text-stone-500">Every order on the platform. Updates every 30 seconds.</p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>
      <div className="flex flex-wrap gap-2">
        <select value={tenant} onChange={(e) => setTenant(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">All restaurants</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">Dine-in and online</option>
          <option value="dine-in">Dine-in</option>
          <option value="online">Online</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">Any status</option>
          {['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data &&
        (q.data.items.length ? (
          <Card>
            <div className="-m-5 overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-stone-100 bg-stone-50/60">
                  <tr>
                    <Th>When</Th>
                    <Th>Restaurant</Th>
                    <Th>Branch</Th>
                    <Th>Order</Th>
                    <Th>Where</Th>
                    <Th>Source</Th>
                    <Th>Items</Th>
                    <Th>Status</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {q.data.items.map((o) => (
                    <tr key={o.id} className="hover:bg-stone-50">
                      <Td>{fmt.time(o.createdAt)}</Td>
                      <Td>
                        <Link to={`/restaurants/${o.tenantId}`} className="hover:underline">
                          {o.restaurant}
                        </Link>
                      </Td>
                      <Td>{o.branch ?? '—'}</Td>
                      <Td className="font-medium">#{o.orderNumber}</Td>
                      <Td>{o.channel === 'dine-in' ? `Table ${o.table ?? '?'}` : o.fulfillment ?? 'online'}</Td>
                      <Td>{o.source ?? '—'}</Td>
                      <Td className="max-w-[280px] truncate">{String(o.items)}</Td>
                      <Td>
                        <Badge tone={o.status === 'cancelled' ? 'bad' : o.status === 'completed' ? 'good' : 'neutral'}>{o.status}</Badge>
                      </Td>
                      <Td right>{fmt.money(o.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Empty>No orders match.</Empty>
        ))}
    </div>
  );
}
