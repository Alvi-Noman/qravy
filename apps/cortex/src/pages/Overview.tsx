// apps/cortex/src/pages/Overview.tsx — the whole platform: restaurants, the guest funnel, orders, the AI waiter.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Overview as OverviewData } from '../api';
import { Card, DaysSelect, ErrorBox, Loading, Stat, Td, Th, fmt } from '../components/ui';
import { FunnelBars, Split, Trend } from '../components/charts';

export default function Overview() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['overview', days], queryFn: () => api<OverviewData>(`/overview?days=${days}`), refetchInterval: 60_000 });
  const d = q.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">Overview</h1>
          <p className="text-[13px] text-stone-500">Every restaurant on Qravy, its guests and its orders.</p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Restaurants" value={fmt.n(d.restaurants.total)} sub={`${d.restaurants.onboarded} onboarded · ${d.restaurants.branches} branches`} />
            <Stat label="Active in period" value={fmt.n(d.restaurants.activeInPeriod)} sub={`${d.restaurants.newInPeriod} new · ${d.restaurants.paying} paying · ${d.restaurants.onTrial} on trial`} />
            <Stat label="Orders" value={fmt.n(d.orders.orders)} sub={`${fmt.money(d.orders.revenue)} · avg ${fmt.money(d.orders.avgOrderValue)}`} />
            <Stat label="Guests right now" value={fmt.n(d.liveGuests)} sub={<Link to="/live" className="underline">see live</Link>} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Guest sessions" value={fmt.n(d.funnel.sessions)} sub={`${fmt.n(d.funnel.pageViews)} page views`} />
            <Stat label="QR scans" value={fmt.n(d.funnel.scans)} sub={`${fmt.pct(d.funnel.rates.scanToOrder)} of scans order`} />
            <Stat label="Visit → order" value={fmt.pct(d.funnel.rates.visitToOrder)} sub={`engaged → order ${fmt.pct(d.funnel.rates.engagedToOrder)}`} />
            <Stat label="Time per session" value={fmt.min(d.funnel.avgMinutes)} sub={`median ${fmt.min(d.funnel.medianMinutes)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Guest sessions per day" subtitle="Visits to any storefront (dine-in and online)">
              <Trend data={d.series} field="sessions" />
            </Card>
            <Card title="Orders per day" subtitle="Every channel, every branch">
              <Trend data={d.series} field="orders" />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Guest funnel" subtitle={`Sessions that reached each step · ${fmt.pct(d.funnel.rates.engagement)} talked to the AI waiter`} className="lg:col-span-2">
              <FunnelBars
                steps={[
                  { label: 'Sessions', value: d.funnel.sessions },
                  { label: 'Added to the tray', value: d.funnel.cartSessions },
                  { label: 'Started checkout', value: d.funnel.checkoutSessions, hint: `${fmt.pct(d.funnel.rates.checkoutAbandon)} of checkouts were abandoned` },
                  { label: 'Ordered', value: d.funnel.orderedSessions },
                ]}
              />
            </Card>
            <Card title="Key rates">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ['Engagement (talked to the AI)', d.funnel.rates.engagement],
                  ['Engaged → order', d.funnel.rates.engagedToOrder],
                  ['Checkout → order', d.funnel.rates.checkoutToOrder],
                  ['Scan → order', d.funnel.rates.scanToOrder],
                  ['Suggestion taken', d.funnel.rates.suggestionTake],
                  ['AI upsell take rate', d.ai.upsell.takeRate],
                  ['Orders from AI-engaged guests', d.funnel.rates.aiEngagedShareOfOrders],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3">
                    <dt className="text-stone-600">{k}</dt>
                    <dd className="font-semibold tabular-nums text-stone-900">{fmt.pct(v as number | null)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Orders by channel">
              <Split parts={[{ label: 'Dine-in', value: d.orders.byChannel['dine-in'] ?? 0 }, { label: 'Online', value: d.orders.byChannel.online ?? 0 }]} />
            </Card>
            <Card title="Orders by source">
              <Split
                parts={[
                  { label: 'AI waiter', value: d.orders.bySource['ai-waiter'] ?? 0 },
                  { label: 'Menu', value: d.orders.bySource.menu ?? 0 },
                  { label: 'Staff', value: d.orders.bySource.staff ?? 0 },
                ]}
              />
            </Card>
            <Card title="AI waiter">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ['Conversations', fmt.n(d.ai.conversations)],
                  ['Turns', fmt.n(d.ai.turns)],
                  ['Not heard (asked to repeat)', fmt.pct(d.ai.unheardRate)],
                  ['Model fallbacks', fmt.pct(d.ai.fallbackRate)],
                  ['Upsell offers / accepted', `${fmt.n(d.ai.upsell.offers)} / ${fmt.n(d.ai.upsell.accepted)}`],
                  ['Upsell revenue', fmt.money(d.ai.upsell.revenue)],
                  ['Suggestions taken', fmt.n(d.funnel.suggestionsAdded)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-stone-600">{k}</dt>
                    <dd className="font-semibold tabular-nums text-stone-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <Card title="Top restaurants" subtitle="By orders in the period">
            {d.topRestaurants.length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-stone-100">
                    <tr>
                      <Th>Restaurant</Th>
                      <Th right>Orders</Th>
                      <Th right>Revenue</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {d.topRestaurants.map((t) => (
                      <tr key={t.tenantId} className="hover:bg-stone-50">
                        <Td>
                          <Link to={`/restaurants/${t.tenantId}`} className="font-medium text-stone-900 hover:underline">
                            {t.name}
                          </Link>
                          <span className="ml-2 text-[12px] text-stone-500">{t.subdomain}</span>
                        </Td>
                        <Td right>{fmt.n(t.orders)}</Td>
                        <Td right>{fmt.money(t.revenue)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[13px] text-stone-500">No orders in this period.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
