// apps/cortex/src/pages/RestaurantDetail.tsx — one restaurant: its setup, guests and orders, per branch × channel.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type AiStats, type Day, type Funnel, type OrderStats, type SessionItem } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, Stat, Td, Th, fmt } from '../components/ui';
import { FunnelBars, Trend } from '../components/charts';
import { SessionsTable } from './Sessions';
import { OpenDashboardButton, SupportHistory } from '../components/SupportAccess';
import { BillingBadge, BillingCard, type BillingSummary } from '../components/Billing';

type Detail = {
  days: number;
  tenant: {
    id: string; name: string; subdomain: string; demo: boolean; owner: string | null; createdAt: string | null; onboarded: boolean;
    subscription: string; plan: string | null; trialEndsAt: string | null; billing: BillingSummary; timezone: string | null; waiterLanguage: string | null;
    channels: { dineIn: boolean; online: boolean }; tables: number;
  };
  branches: Array<{ id: string; name: string; slug: string | null; address: string; disabled: boolean; tables: number; main: boolean }>;
  team: {
    members: Array<{ role: string; email: string | null; branch: string | null }>;
    devices: Array<{ label: string | null; branch: string | null; lastSeenAt: string | null; status: string }>;
  };
  funnel: Funnel;
  orders: OrderStats;
  ai: AiStats;
  waiterCalls: number;
  series: Day[];
  byBranch: Array<{ locationId: string | null; branch: string; channel: string; sessions: number; scans: number; engagedSessions: number; checkoutSessions: number; orderedSessions: number; orders: number; revenue: number; visitToOrder: number | null; engagedToOrder: number | null; avgMinutes: number | null }>;
  recentOrders: Array<{ id: string; orderNumber: number; status: string; total: number; channel: string; branch: string | null; table: string | null; source: string | null; items: number; createdAt: string }>;
};

export default function RestaurantDetail() {
  const { id } = useParams();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['tenant', id, days], queryFn: () => api<Detail>(`/tenants/${id}?days=${days}`) });
  const sessions = useQuery({
    queryKey: ['tenant-sessions', id, days],
    queryFn: () => api<{ items: SessionItem[]; total: number }>(`/sessions?tenant=${id}&days=${days}&limit=30`),
  });
  const d = q.data;

  return (
    <div className="space-y-6">
      <Link to="/restaurants" className="text-[13px] text-stone-500 hover:text-stone-800">
        ← Restaurants
      </Link>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <>
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold text-stone-900">{d.tenant.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-stone-500">
                <span>{d.tenant.subdomain}.qravy.com</span>
                {d.tenant.owner && <span>· {d.tenant.owner}</span>}
                <span>· joined {fmt.date(d.tenant.createdAt)}</span>
                {d.tenant.demo && <Badge tone="info">demo</Badge>}
                {d.tenant.onboarded ? <Badge tone="good">onboarded</Badge> : <Badge tone="warn">onboarding</Badge>}
                <BillingBadge b={d.tenant.billing} />
                {d.tenant.channels.dineIn && <Badge>dine-in</Badge>}
                {d.tenant.channels.online && <Badge>online</Badge>}
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-end gap-2">
              <OpenDashboardButton tenantId={d.tenant.id} name={d.tenant.name} />
              <DaysSelect value={days} onChange={setDays} />
            </div>
          </header>

          <BillingCard tenantId={d.tenant.id} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Guest sessions" value={fmt.n(d.funnel.sessions)} sub={`${fmt.n(d.funnel.scans)} QR scans · ${fmt.n(d.funnel.pageViews)} page views`} />
            <Stat label="Orders" value={fmt.n(d.orders.orders)} sub={`${fmt.money(d.orders.revenue)} · avg ${fmt.money(d.orders.avgOrderValue)}`} />
            <Stat label="Visit → order" value={fmt.pct(d.funnel.rates.visitToOrder)} sub={`engaged → order ${fmt.pct(d.funnel.rates.engagedToOrder)}`} />
            <Stat label="Time per session" value={fmt.min(d.funnel.avgMinutes)} sub={`${fmt.n(d.waiterCalls)} table calls`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Guest sessions per day">
              <Trend data={d.series} field="sessions" />
            </Card>
            <Card title="Orders per day">
              <Trend data={d.series} field="orders" />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Guest funnel" subtitle={`${fmt.pct(d.funnel.rates.engagement)} of sessions talked to the AI waiter`} className="lg:col-span-2">
              <FunnelBars
                steps={[
                  { label: 'Sessions', value: d.funnel.sessions },
                  { label: 'Added to the tray', value: d.funnel.cartSessions },
                  { label: 'Started checkout', value: d.funnel.checkoutSessions },
                  { label: 'Ordered', value: d.funnel.orderedSessions },
                ]}
              />
            </Card>
            <Card title="AI waiter">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ['Conversations', fmt.n(d.ai.conversations)],
                  ['Turns', fmt.n(d.ai.turns)],
                  ['Not heard', fmt.pct(d.ai.unheardRate)],
                  ['Orders by the waiter', fmt.n(d.ai.ordersByWaiter)],
                  ['Suggestions taken', fmt.n(d.funnel.suggestionsAdded)],
                  ['Upsell take rate', fmt.pct(d.ai.upsell.takeRate)],
                  ['Upsell revenue', fmt.money(d.ai.upsell.revenue)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-stone-600">{k}</dt>
                    <dd className="font-semibold tabular-nums text-stone-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <Card title="By branch and channel" subtitle="Dine-in (table QR codes) and online (pickup / delivery) separately">
            {d.byBranch.length ? (
              <div className="-m-5 overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-100 bg-stone-50/60">
                    <tr>
                      <Th>Branch</Th>
                      <Th>Channel</Th>
                      <Th right>Sessions</Th>
                      <Th right>Scans</Th>
                      <Th right>Engaged</Th>
                      <Th right>Checkout</Th>
                      <Th right>Orders</Th>
                      <Th right>Revenue</Th>
                      <Th right>Visit→order</Th>
                      <Th right>Engaged→order</Th>
                      <Th right>Avg time</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {d.byBranch.map((b) => (
                      <tr key={`${b.locationId}|${b.channel}`}>
                        <Td className="font-medium">{b.branch}</Td>
                        <Td>{b.channel}</Td>
                        <Td right>{fmt.n(b.sessions)}</Td>
                        <Td right>{fmt.n(b.scans)}</Td>
                        <Td right>{fmt.n(b.engagedSessions)}</Td>
                        <Td right>{fmt.n(b.checkoutSessions)}</Td>
                        <Td right>{fmt.n(b.orders)}</Td>
                        <Td right>{fmt.money(b.revenue)}</Td>
                        <Td right>{fmt.pct(b.visitToOrder)}</Td>
                        <Td right>{fmt.pct(b.engagedToOrder)}</Td>
                        <Td right>{fmt.min(b.avgMinutes)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No activity in this period.</Empty>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Branches (${d.branches.length})`}>
              {d.branches.length ? (
                <ul className="divide-y divide-stone-100 text-[13px]">
                  {d.branches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <span className="font-medium text-stone-900">{b.name}</span>
                        {b.main && <span className="ml-1.5"><Badge tone="info">main link</Badge></span>}
                        {b.disabled && <span className="ml-1.5"><Badge tone="bad">off</Badge></span>}
                        <div className="text-[12px] text-stone-500">/{b.slug} · {b.address || 'no address'}</div>
                      </div>
                      <span className="text-stone-500">{b.tables} tables</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-stone-500">No branches — {d.tenant.tables} restaurant-wide tables.</p>
              )}
            </Card>
            <Card title="Team and devices">
              <ul className="divide-y divide-stone-100 text-[13px]">
                {d.team.members.map((m, i) => (
                  <li key={`m${i}`} className="flex justify-between gap-3 py-2">
                    <span className="text-stone-900">{m.email ?? '—'}</span>
                    <span className="text-stone-500">{m.role}{m.branch ? ` · ${m.branch} only` : ''}</span>
                  </li>
                ))}
                {d.team.devices.map((v, i) => (
                  <li key={`d${i}`} className="flex justify-between gap-3 py-2">
                    <span className="text-stone-900">🖥 {v.label ?? 'device'}</span>
                    <span className="text-stone-500">{v.branch ?? 'unassigned'} · {fmt.ago(v.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Recent guest sessions" right={<Link to={`/sessions?tenant=${d.tenant.id}`} className="text-[13px] underline">all</Link>}>
            {sessions.data ? <SessionsTable items={sessions.data.items} hideRestaurant /> : <Loading />}
          </Card>

          <Card title="Recent orders">
            <div className="-m-5 overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-stone-100 bg-stone-50/60">
                  <tr>
                    <Th>Order</Th>
                    <Th>Branch</Th>
                    <Th>Where</Th>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    <Th right>Items</Th>
                    <Th right>Total</Th>
                    <Th right>When</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {d.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-medium">#{o.orderNumber}</Td>
                      <Td>{o.branch ?? '—'}</Td>
                      <Td>{o.channel === 'dine-in' ? `Table ${o.table ?? '?'}` : 'Online'}</Td>
                      <Td>{o.source ?? '—'}</Td>
                      <Td><Badge tone={o.status === 'cancelled' ? 'bad' : o.status === 'completed' ? 'good' : 'neutral'}>{o.status}</Badge></Td>
                      <Td right>{o.items}</Td>
                      <Td right>{fmt.money(o.total)}</Td>
                      <Td right>{fmt.time(o.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <SupportHistory tenantId={d.tenant.id} />
        </>
      )}
    </div>
  );
}
