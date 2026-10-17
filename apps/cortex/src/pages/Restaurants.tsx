// apps/cortex/src/pages/Restaurants.tsx — every restaurant (onboarded or not) with its activity in the period.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type TenantRow } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, Td, Th, fmt } from '../components/ui';
import { BillingBadge, PriceCell } from '../components/Billing';

type SortKey = 'createdAt' | 'orders' | 'revenue' | 'sessions' | 'lastActivity' | 'visitToOrder' | 'expires';

export default function Restaurants() {
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'onboarded' | 'not-onboarded' | 'due' | 'custom' | 'demos'>('all');
  const [sort, setSort] = useState<SortKey>('createdAt');
  const q = useQuery({ queryKey: ['tenants', days], queryFn: () => api<{ items: TenantRow[] }>(`/tenants?days=${days}`) });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (q.data?.items ?? []).filter((t) => {
      if (show === 'demos' ? !t.demo : t.demo) return false;
      if (show === 'onboarded' && !t.onboarded) return false;
      if (show === 'not-onboarded' && t.onboarded) return false;
      if (show === 'due' && t.billing?.status !== 'due' && t.billing?.status !== 'overdue') return false;
      if (show === 'custom' && !t.billing?.customPrice) return false;
      return !s || [t.name, t.subdomain, t.owner ?? ''].some((v) => v.toLowerCase().includes(s));
    });
    // expires: soonest first (overdue at the top), no date last
    if (sort === 'expires') {
      const e = (t: TenantRow) => (t.billing?.expiresAt ? new Date(t.billing.expiresAt).getTime() : Infinity);
      return [...list].sort((a, b) => e(a) - e(b));
    }
    const val = (t: TenantRow) =>
      sort === 'createdAt' || sort === 'lastActivity' ? new Date(t[sort] ?? 0).getTime() : Number(t[sort] ?? -1);
    return [...list].sort((a, b) => val(b) - val(a));
  }, [q.data, search, show, sort]);

  const SortTh = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-stone-500">
      <button type="button" onClick={() => setSort(k)} className={sort === k ? 'text-stone-900 underline' : 'hover:text-stone-800'}>
        {children}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">Restaurants</h1>
          <p className="text-[13px] text-stone-500">Sign-ups, onboarding, plans and what each restaurant&apos;s guests did.</p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, subdomain or owner email"
          className="w-72 max-w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-stone-500"
        />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="all">All restaurants</option>
          <option value="onboarded">Onboarded</option>
          <option value="not-onboarded">Not onboarded yet</option>
          <option value="due">Due or overdue</option>
          <option value="custom">Custom price</option>
          <option value="demos">Quick demos</option>
        </select>
        <span className="text-[12px] text-stone-500">{rows.length} shown</span>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data &&
        (rows.length ? (
          <Card>
            <div className="-m-5 overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-stone-100 bg-stone-50/60">
                  <tr>
                    <Th>Restaurant</Th>
                    <Th>Status</Th>
                    <Th right>Price</Th>
                    <SortTh k="expires">Expires</SortTh>
                    <Th right>Branches</Th>
                    <SortTh k="sessions">Sessions</SortTh>
                    <Th right>Scans</Th>
                    <Th right>Engaged</Th>
                    <SortTh k="orders">Orders</SortTh>
                    <SortTh k="revenue">Revenue</SortTh>
                    <SortTh k="visitToOrder">Visit→order</SortTh>
                    <Th right>AI chats</Th>
                    <SortTh k="lastActivity">Last active</SortTh>
                    <SortTh k="createdAt">Joined</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((t) => (
                    <tr key={t.id} className="hover:bg-stone-50">
                      <Td>
                        <Link to={`/restaurants/${t.id}`} className="font-medium text-stone-900 hover:underline">
                          {t.name}
                        </Link>
                        <div className="text-[12px] text-stone-500">
                          {t.subdomain}
                          {t.owner ? ` · ${t.owner}` : ''}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {t.demo && <Badge tone="info">demo</Badge>}
                          {t.onboarded ? <Badge tone="good">onboarded</Badge> : <Badge tone="warn">onboarding</Badge>}
                          <BillingBadge b={t.billing} />
                        </div>
                      </Td>
                      <Td right>
                        <PriceCell b={t.billing} />
                      </Td>
                      <Td right className="whitespace-nowrap">{fmt.date(t.billing?.expiresAt)}</Td>
                      <Td right>{t.branches}</Td>
                      <Td right>{fmt.n(t.sessions)}</Td>
                      <Td right>{fmt.n(t.scans)}</Td>
                      <Td right>{fmt.n(t.engagedSessions)}</Td>
                      <Td right>{fmt.n(t.orders)}</Td>
                      <Td right>{fmt.money(t.revenue)}</Td>
                      <Td right>{fmt.pct(t.visitToOrder)}</Td>
                      <Td right>{fmt.n(t.conversations)}</Td>
                      <Td right>{fmt.ago(t.lastActivity)}</Td>
                      <Td right>{fmt.date(t.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Empty>No restaurants match.</Empty>
        ))}
    </div>
  );
}
