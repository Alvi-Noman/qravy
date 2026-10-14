// apps/braincell/src/components/Dashboard/HomeInsights.tsx — the home dashboard.
// About guests, not the order queue (that's Orders): how many scanned a QR code, how many became guests and ordered,
// how long they stayed, which tables get scanned, and dine-in vs online side by side. Every number sits next to the
// period before it. Today by default, in the restaurant's own time; a branch login sees its branch (the server decides).
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowPathIcon,
  ClockIcon,
  DevicePhoneMobileIcon,
  QrCodeIcon,
  ShoppingBagIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { getDashboard, type Dashboard, type DashRange, type DashSummary } from '../../api/insights';
import { useScope } from '../../context/ScopeContext';
import {
  BarsChart,
  ChannelBars,
  CompareChart,
  Delta,
  DINE_IN,
  Funnel,
  ONLINE,
  Panel,
  Split,
  StatTile,
  fmt,
} from '../insights/Charts';

const RANGES: Array<[DashRange, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['month', 'This month'],
  ['custom', 'Custom'],
];
const PREV_LABEL: Record<DashRange, string> = {
  today: 'yesterday',
  yesterday: 'the day before',
  '7d': 'the 7 days before',
  '30d': 'the 30 days before',
  month: 'the same days before',
  custom: 'the same length before',
};

const HOUR = (h: string | number) => {
  const n = Number(h);
  return n === 0 ? '12am' : n < 12 ? `${n}am` : n === 12 ? '12pm' : `${n - 12}pm`;
};
const DAY = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const todayStr = () => new Date().toLocaleDateString('en-CA');

type Metric = 'scans' | 'guests' | 'orders' | 'revenue';
const METRICS: Array<[Metric, string]> = [
  ['scans', 'QR scans'],
  ['guests', 'Guests'],
  ['orders', 'Orders'],
  ['revenue', 'Revenue'],
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-[#e5e5e5] bg-white p-0.5 text-[13px]" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 ${value === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** One side of the dine-in / online comparison. */
function ChannelColumn({ name, color, cur, prev, share }: { name: string; color: string; cur: DashSummary; prev: DashSummary; share: number | null }) {
  const rows: Array<[string, ReactNode, ReactNode]> = [
    ['Guests', fmt.n(cur.guests), <Delta key="g" now={cur.guests} before={prev.guests} />],
    ['QR scans', fmt.n(cur.scans), <Delta key="s" now={cur.scans} before={prev.scans} />],
    ['Guests who ordered', fmt.pct(cur.conversion), <Delta key="c" now={cur.conversion} before={prev.conversion} points />],
    ['Time on the menu', fmt.min(cur.avgMinutes), <Delta key="m" now={cur.avgMinutes} before={prev.avgMinutes} />],
    ['Orders', fmt.n(cur.orders), <Delta key="o" now={cur.orders} before={prev.orders} />],
    ['Revenue', fmt.money(cur.revenue), <Delta key="r" now={cur.revenue} before={prev.revenue} />],
    ['Average order', fmt.money(cur.avgOrderValue), <Delta key="a" now={cur.avgOrderValue} before={prev.avgOrderValue} />],
    ['Ordered through the AI waiter', fmt.n(cur.aiOrders), null],
  ];
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
          <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
          {name}
        </div>
        {share != null && <span className="text-[12px] text-slate-500">{fmt.pct(share)} of guests</span>}
      </div>
      <dl className="space-y-2 text-[13px]">
        {rows.map(([k, v, d]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-600">{k}</dt>
            <dd className="flex items-baseline gap-2">
              <span className="font-semibold tabular-nums text-slate-900">{v}</span>
              <span className="w-16 text-right">{d}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function HomeInsights() {
  const { activeLocationId, setActiveLocationId } = useScope();
  const [range, setRange] = useState<DashRange>('today');
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [channel, setChannel] = useState<'' | 'dine-in' | 'online'>('');
  const [metric, setMetric] = useState<Metric>('scans');
  const [funnelOf, setFunnelOf] = useState<'dine-in' | 'online'>('dine-in');

  const q = useQuery({
    queryKey: ['home-dashboard', range, range === 'custom' ? from : '', range === 'custom' ? to : '', activeLocationId, channel],
    queryFn: () => getDashboard({ range, from, to, location: activeLocationId, channel: channel || null }),
    // today keeps itself fresh; a past period doesn't change
    refetchInterval: (query) => ((query.state.data as Dashboard | undefined)?.period.includesNow ? 60_000 : false),
  });
  const d = q.data;
  const xFmt = d?.period.bucket === 'hour' ? HOUR : DAY;

  const trend = useMemo(
    () => (d ? d.series.map((pt, i) => ({ x: pt.key, now: pt[metric], before: d.prevSeries[i]?.[metric] ?? 0 })) : []),
    [d, metric]
  );
  const channelSeries = useMemo(
    () => (d ? d.series.map((pt) => ({ x: pt.key, dineIn: pt.dineInGuests, online: pt.onlineGuests })) : []),
    [d]
  );

  const s = d?.summary;
  const p = d?.previous;
  const totalGuests = d ? d.channels['dine-in'].current.guests + d.channels.online.current.guests : 0;

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-[#2e2e30]">
      <header className="sticky top-0 z-20 border-b border-[#ececec] bg-white/80 px-6 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#2e2e30]">Dashboard</h2>
            <p className="text-[12px] text-slate-500">
              {d
                ? `${d.period.from === d.period.to ? DAY(d.period.from) : `${DAY(d.period.from)} – ${DAY(d.period.to)}`} · compared with ${PREV_LABEL[d.period.key]}`
                : 'Guests, QR scans and dine-in vs online'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Dine-in or online" value={channel} onChange={setChannel} options={[['', 'All'], ['dine-in', 'Dine-in'], ['online', 'Online']]} />
            <Segmented label="Period" value={range} onChange={setRange} options={RANGES} />
            <button
              type="button"
              onClick={() => q.refetch()}
              className="rounded-lg border border-[#e5e5e5] bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Refresh"
              title="Refresh"
            >
              <ArrowPathIcon className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {range === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5 text-slate-600">
              From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-[#e2e2e2] px-2 py-1" />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">
              To
              <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-[#e2e2e2] px-2 py-1" />
            </label>
          </div>
        )}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {q.isLoading && <div className="p-10 text-center text-slate-500">Loading…</div>}
        {q.error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">Could not load the dashboard. Please refresh.</div>}
        {d && s && p && (
          <>
            {d.now && d.now.total === 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-300" /> No guests on your menu right now
              </div>
            )}
            {d.now && d.now.total > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <b>{d.now.total} {d.now.total === 1 ? 'guest' : 'guests'} on your menu right now</b>
                <span className="text-emerald-800">
                  {d.now.dineIn} at tables · {d.now.online} online
                </span>
              </div>
            )}

            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              <StatTile icon={<QrCodeIcon className="h-4 w-4" />} label="QR scans" value={fmt.n(s.scans)} delta={<Delta now={s.scans} before={p.scans} />} hint={`${fmt.n(s.scannedGuests)} guests scanned`} />
              <StatTile icon={<UsersIcon className="h-4 w-4" />} label="Guests" value={fmt.n(s.guests)} delta={<Delta now={s.guests} before={p.guests} />} hint={`${fmt.n(s.uniqueDevices)} phones`} />
              <StatTile
                icon={<ShoppingBagIcon className="h-4 w-4" />}
                label="Guests who ordered"
                value={fmt.pct(s.conversion)}
                delta={<Delta now={s.conversion} before={p.conversion} points />}
                hint={`${fmt.n(s.orderingGuests)} of ${fmt.n(s.guests)} · scan → order ${fmt.pct(s.scanToOrder)}`}
              />
              <StatTile
                icon={<ClockIcon className="h-4 w-4" />}
                label="Time on the menu"
                value={fmt.min(s.avgMinutes)}
                delta={<Delta now={s.avgMinutes} before={p.avgMinutes} />}
                hint={`typical ${fmt.min(s.medianMinutes)} · ${s.pagesPerGuest ?? '—'} pages each`}
              />
              <StatTile
                icon={<UserGroupIcon className="h-4 w-4" />}
                label="Returning guests"
                value={fmt.pct(s.uniqueDevices ? s.returningGuests / s.uniqueDevices : null)}
                delta={<Delta now={s.returningGuests} before={p.returningGuests} />}
                hint={`${fmt.n(s.returningGuests)} back · ${fmt.n(s.newGuests)} new`}
              />
              <StatTile
                icon={<DevicePhoneMobileIcon className="h-4 w-4" />}
                label="Left without doing anything"
                value={fmt.pct(s.bounceRate)}
                delta={<Delta now={s.bounceRate} before={p.bounceRate} upIsGood={false} points />}
                hint="one page, no tray, no waiter"
              />
            </section>

            <Panel
              title="Over time"
              subtitle={d.period.bucket === 'hour' ? `By hour (${d.period.timezone})` : 'By day'}
              right={<Segmented label="Measure" value={metric} onChange={setMetric} options={METRICS} />}
            >
              <CompareChart data={trend} xFmt={xFmt} unit={metric === 'revenue' ? (v) => fmt.money(v) : undefined} />
            </Panel>

            <Panel title="Dine-in vs online" subtitle="Tables (QR codes at the restaurant) and the online shop, side by side">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChannelColumn
                  name="Dine-in"
                  color={DINE_IN}
                  cur={d.channels['dine-in'].current}
                  prev={d.channels['dine-in'].previous}
                  share={totalGuests ? d.channels['dine-in'].current.guests / totalGuests : null}
                />
                <ChannelColumn
                  name="Online"
                  color={ONLINE}
                  cur={d.channels.online.current}
                  prev={d.channels.online.previous}
                  share={totalGuests ? d.channels.online.current.guests / totalGuests : null}
                />
              </div>
              <div className="mt-5">
                <div className="mb-1 text-[13px] font-semibold text-slate-900">Guests {d.period.bucket === 'hour' ? 'by hour' : 'by day'}</div>
                <ChannelBars data={channelSeries} xFmt={xFmt} />
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="What guests did"
                subtitle="Share of all guests who did each (some order through the AI waiter without opening checkout)"
                right={<Segmented label="Channel" value={funnelOf} onChange={setFunnelOf} options={[['dine-in', 'Dine-in'], ['online', 'Online']]} />}
              >
                {(() => {
                  const f = d.channels[funnelOf].funnel;
                  return (
                    <Funnel
                      steps={[
                        { label: 'Guests', value: f.sessions },
                        { label: 'Talked to the AI waiter', value: f.engagedSessions },
                        { label: 'Added something to the tray', value: f.cartSessions },
                        { label: 'Opened checkout', value: f.checkoutSessions },
                        { label: 'Ordered', value: f.orderedSessions },
                      ]}
                    />
                  );
                })()}
              </Panel>
              <Panel title="When guests scan" subtitle={`QR scans by hour of day (${d.period.timezone})`}>
                <BarsChart data={d.byHour} x="hour" field="scans" xFmt={HOUR} />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Tables" subtitle="Which table QR codes get scanned, and how often that ends in an order" className="lg:col-span-2">
                {d.tables.length ? (
                  <div className="-mx-5 -mb-5 overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="border-y border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">Table</th>
                          <th className="px-4 py-2 text-right font-semibold">Scans</th>
                          <th className="px-4 py-2 text-right font-semibold">Guests</th>
                          <th className="px-4 py-2 text-right font-semibold">Ordered</th>
                          <th className="px-4 py-2 text-right font-semibold">Scan → order</th>
                          <th className="px-4 py-2 text-right font-semibold">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.tables.map((t) => (
                          <tr key={t.table}>
                            <td className="px-4 py-2 font-medium text-slate-900">Table {t.table}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt.n(t.scans)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt.n(t.guests)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt.n(t.ordered)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt.pct(t.conversion)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{fmt.min(t.avgMinutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-500">No table QR codes scanned in this period.</p>
                )}
              </Panel>
              <Panel title="Guests’ devices">
                <Split
                  parts={[
                    { label: 'Phones', value: d.devices.mobile ?? 0 },
                    { label: 'Tablets', value: d.devices.tablet ?? 0 },
                    { label: 'Computers', value: d.devices.desktop ?? 0 },
                  ]}
                />
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-semibold text-slate-900">New and returning</div>
                  <Split
                    parts={[
                      { label: 'First visit', value: s.newGuests },
                      { label: 'Been here before', value: s.returningGuests },
                    ]}
                  />
                </div>
              </Panel>
            </div>

            {!activeLocationId && d.branches.length > 1 && (
              <Panel title="Branches" subtitle="Click a branch to see just that one">
                <div className="-mx-5 -mb-5 overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-y border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Branch</th>
                        <th className="px-4 py-2 text-right font-semibold">Scans</th>
                        <th className="px-4 py-2 text-right font-semibold">Guests</th>
                        <th className="px-4 py-2 text-right font-semibold">Dine-in</th>
                        <th className="px-4 py-2 text-right font-semibold">Online</th>
                        <th className="px-4 py-2 text-right font-semibold">Ordered</th>
                        <th className="px-4 py-2 text-right font-semibold">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {d.branches.map((b) => (
                        <tr key={b.locationId} className="cursor-pointer hover:bg-slate-50" onClick={() => setActiveLocationId(b.locationId)}>
                          <td className="px-4 py-2 font-medium text-slate-900">{b.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.n(b.scans)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.n(b.guests)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.n(b.dineInGuests)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.n(b.onlineGuests)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.pct(b.conversion)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt.min(b.avgMinutes)}</td>
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
    </div>
  );
}
