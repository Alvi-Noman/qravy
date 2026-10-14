// apps/braincell/src/pages/reports/SalesReport.tsx — Insights → Sales Reports: how the restaurant is doing.
// Revenue and orders, guests and how many order, the AI waiter, busy hours, top dishes, and (all branches) each
// branch side by side. A branch login sees its own branch only (the server decides); owners and admins switch
// between all branches combined and one branch with the location selector (top left) or a branch row here.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BanknotesIcon,
  ChatBubbleLeftRightIcon,
  QrCodeIcon,
  ReceiptPercentIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { getInsights } from '../../api/insights';
import { useScope } from '../../context/ScopeContext';
import { useAuthContext } from '../../context/AuthContext';
import { BarsChart, Funnel, Kpi, Panel, Period, Split, TrendChart, fmt } from '../../components/insights/Charts';

const HOUR = (h: string | number) => {
  const n = Number(h);
  return n === 0 ? '12am' : n < 12 ? `${n}am` : n === 12 ? '12pm' : `${n - 12}pm`;
};

export default function SalesReport() {
  const { activeLocationId, setActiveLocationId } = useScope();
  const { session } = useAuthContext();
  const branchLogin = session?.type === 'central';
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState('');
  const q = useQuery({
    queryKey: ['insights', days, activeLocationId, channel],
    queryFn: () => getInsights(days, activeLocationId, channel || null),
    refetchInterval: 60_000,
  });
  const d = q.data;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900">Sales Reports</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {d?.branch ? (
              <>
                <span className="font-medium text-slate-800">{d.branch}</span>
                {branchLogin ? ' — this branch only.' : ' — one branch. Pick “All locations” (top left) to see every branch combined.'}
              </>
            ) : (
              'Every branch combined. Pick a branch (top left, or a row below) to see just that one.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-[#e5e5e5] bg-white px-2 py-2 text-[13px]" aria-label="Channel">
            <option value="">Dine-in and online</option>
            <option value="dine-in">Dine-in</option>
            <option value="online">Online</option>
          </select>
          <Period value={days} onChange={setDays} />
        </div>
      </header>

      {q.isLoading && <div className="p-10 text-center text-sm text-slate-500">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load the report.</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={<BanknotesIcon className="h-4 w-4" />} label="Revenue" value={fmt.money(d.orders.revenue)} sub={`avg order ${fmt.money(d.orders.avgOrderValue)}`} />
            <Kpi icon={<ReceiptPercentIcon className="h-4 w-4" />} label="Orders" value={fmt.n(d.orders.orders)} sub={`${fmt.n(d.orders.completed)} completed · ${fmt.n(d.orders.cancelled)} cancelled`} />
            <Kpi icon={<UsersIcon className="h-4 w-4" />} label="Guests" value={fmt.n(d.funnel.sessions)} sub={`${fmt.n(d.funnel.scans)} QR scans · ${fmt.min(d.funnel.avgMinutes)} each`} />
            <Kpi icon={<QrCodeIcon className="h-4 w-4" />} label="Guests who order" value={fmt.pct(d.funnel.rates.visitToOrder)} sub={`${fmt.pct(d.funnel.rates.engagedToOrder)} of those who talk to the AI`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Revenue per day">
              <TrendChart data={d.series} field="revenue" unit={(v) => fmt.money(v)} />
            </Panel>
            <Panel title="Orders per day">
              <TrendChart data={d.series} field="orders" />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="From visit to order" subtitle={`${fmt.pct(d.funnel.rates.engagement)} of guests talked to the AI waiter`} className="lg:col-span-2">
              <Funnel
                steps={[
                  { label: 'Guests', value: d.funnel.sessions },
                  { label: 'Added something to the tray', value: d.funnel.cartSessions },
                  { label: 'Opened checkout', value: d.funnel.checkoutSessions, hint: d.funnel.checkoutSessions ? `${fmt.pct(d.funnel.rates.checkoutAbandon)} left at checkout` : undefined },
                  { label: 'Ordered', value: d.funnel.orderedSessions },
                ]}
              />
            </Panel>
            <Panel title="Rates">
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ['Guests who order', d.funnel.rates.visitToOrder],
                  ['Talked to the AI → ordered', d.funnel.rates.engagedToOrder],
                  ['Opened checkout → ordered', d.funnel.rates.checkoutToOrder],
                  ['Scanned a QR code → ordered', d.funnel.rates.scanToOrder],
                  ['Took an AI suggestion', d.funnel.rates.suggestionTake],
                  ['AI offers accepted', d.ai.upsell.takeRate],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3">
                    <dt className="text-slate-600">{k}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{fmt.pct(v as number | null)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Busiest hours" subtitle={`Orders by hour (${d.timezone})`} className="lg:col-span-2">
              <BarsChart data={d.byHour} x="hour" field="orders" xFmt={HOUR} />
            </Panel>
            <Panel title="Busiest days">
              <BarsChart data={d.byWeekday} x="day" field="orders" />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Top dishes" subtitle="By quantity sold" right={<Link to="/reports/menu-performance" className="text-[12px] text-slate-600 underline">all dishes</Link>} className="lg:col-span-2">
              {d.topItems.length ? (
                <ul className="space-y-2.5">
                  {d.topItems.map((t, i) => (
                    <li key={t.itemId} className="text-[13px]">
                      <div className="mb-1 flex justify-between gap-3">
                        <span className="text-slate-800">
                          <span className="mr-2 text-slate-400">{i + 1}</span>
                          {t.name}
                        </span>
                        <span className="tabular-nums text-slate-600">
                          <span className="font-semibold text-slate-900">{fmt.n(t.qty)}</span> sold · {fmt.money(t.revenue)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${(t.qty / Math.max(1, d.topItems[0].qty)) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-500">No dishes sold in this period.</p>
              )}
            </Panel>
            <Panel title="AI waiter" right={<ChatBubbleLeftRightIcon className="h-4 w-4 text-slate-400" />}>
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ['Conversations', fmt.n(d.ai.conversations)],
                  ['Orders it took', fmt.n(d.ai.ordersByWaiter)],
                  ['Suggestions taken', fmt.n(d.funnel.suggestionsAdded)],
                  ['Offers accepted', `${fmt.n(d.ai.upsell.accepted)} of ${fmt.n(d.ai.upsell.offers)}`],
                  ['Extra revenue from offers', fmt.money(d.ai.upsell.revenue)],
                  ['Asked guests to repeat', fmt.pct(d.ai.unheardRate)],
                  ['Table calls', fmt.n(d.waiterCalls)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-slate-600">{k}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Dine-in and online" subtitle="Orders">
              <Split parts={[{ label: 'Dine-in (tables)', value: d.orders.byChannel['dine-in'] ?? 0 }, { label: 'Online (pickup / delivery)', value: d.orders.byChannel.online ?? 0 }]} />
            </Panel>
            <Panel title="How orders came in">
              <Split
                parts={[
                  { label: 'Talking to the AI waiter', value: d.orders.bySource['ai-waiter'] ?? 0 },
                  { label: 'From the menu', value: d.orders.bySource.menu ?? 0 },
                  { label: 'Entered by staff', value: d.orders.bySource.staff ?? 0 },
                ]}
              />
            </Panel>
          </div>

          {!d.branch && d.byBranch.length > 1 && (
            <Panel title="Branches side by side" subtitle="Click a branch to see just that one">
              <div className="-m-5 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Branch</th>
                      <th className="px-4 py-2 text-right font-semibold">Revenue</th>
                      <th className="px-4 py-2 text-right font-semibold">Orders</th>
                      <th className="px-4 py-2 text-right font-semibold">Dine-in</th>
                      <th className="px-4 py-2 text-right font-semibold">Online</th>
                      <th className="px-4 py-2 text-right font-semibold">Guests</th>
                      <th className="px-4 py-2 text-right font-semibold">Guests who order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.byBranch.map((b) => (
                      <tr key={b.locationId} className="cursor-pointer hover:bg-slate-50" onClick={() => setActiveLocationId(b.locationId)}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{b.branch}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.money(b.revenue)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(b.orders)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(b.dineIn)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(b.online)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(b.sessions)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt.pct(b.visitToOrder)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
