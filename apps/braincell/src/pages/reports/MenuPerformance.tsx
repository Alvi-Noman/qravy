// apps/braincell/src/pages/reports/MenuPerformance.tsx — Insights → Menu Performance: how each dish sells.
// Quantity, revenue and share, how often guests add it but don't buy it, what the AI waiter sells, dine-in vs online,
// and the dishes that aren't selling. Same scope rules as Sales Reports: a branch login sees its branch's menu only.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMenuInsights, type MenuInsight } from '../../api/insights';
import { useScope } from '../../context/ScopeContext';
import { Kpi, Panel, Period, fmt } from '../../components/insights/Charts';

type SortKey = 'revenue' | 'qty' | 'inOrders' | 'byWaiter' | 'suggestedAdds' | 'addedToTray' | 'name';

const COLS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: 'name', label: 'Dish' },
  { key: 'qty', label: 'Sold' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'inOrders', label: 'In orders', hint: 'Share of all orders that had this dish' },
  { key: 'addedToTray', label: 'Added to tray', hint: 'Times guests added it, bought or not' },
  { key: 'byWaiter', label: 'Sold by AI', hint: 'Quantity sold in orders taken by the AI waiter' },
  { key: 'suggestedAdds', label: 'From AI suggestions', hint: 'Times guests added it after the AI suggested it' },
];

const since = (iso: string | null) => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

export default function MenuPerformance() {
  const { activeLocationId } = useScope();
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState<SortKey>('revenue');
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['insights-menu', days, activeLocationId, channel],
    queryFn: () => getMenuInsights(days, activeLocationId, channel || null),
  });
  const items = q.data?.items ?? [];

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = items.filter((i) => i.active && (!s || i.name.toLowerCase().includes(s) || (i.category ?? '').toLowerCase().includes(s)));
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] as number) - (a[sort] as number)));
  }, [items, sort, search]);

  const selling = items.filter((i) => i.qty > 0);
  const notSelling = items.filter((i) => i.active && i.qty === 0);
  const leftInTray = items
    .filter((i) => i.addedToTray >= 3 && i.addedToTray > i.inOrders)
    .map((i) => ({ ...i, gap: i.addedToTray - i.inOrders }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  const totalRevenue = selling.reduce((s, i) => s + i.revenue, 0);
  const top3Share = [...selling].sort((a, b) => b.revenue - a.revenue).slice(0, 3).reduce((s, i) => s + i.revenueShare, 0);
  const aiQty = selling.reduce((s, i) => s + i.byWaiter, 0);
  const qty = selling.reduce((s, i) => s + i.qty, 0);
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900">Menu Performance</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">How each dish sells{activeLocationId ? ' at this branch' : ' across every branch'}.</p>
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
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load menu performance.</div>}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Dishes sold" value={fmt.n(qty)} sub={`${fmt.n(q.data.orders)} orders · ${fmt.money(totalRevenue)}`} />
            <Kpi label="Dishes selling" value={`${selling.length} of ${items.filter((i) => i.active).length}`} sub={`${notSelling.length} on the menu with no sales`} />
            <Kpi label="Top 3 dishes" value={fmt.pct(selling.length ? top3Share : null)} sub="of dish revenue" />
            <Kpi label="Sold by the AI waiter" value={fmt.pct(qty ? aiQty / qty : null)} sub={`${fmt.n(aiQty)} ${aiQty === 1 ? 'dish' : 'dishes'}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Added but not ordered" subtitle="Guests put these in the tray more often than they bought them">
              {leftInTray.length ? (
                <ul className="divide-y divide-slate-100 text-[13px]">
                  {leftInTray.map((i) => (
                    <li key={i.itemId} className="flex justify-between gap-3 py-2">
                      <span className="text-slate-800">{i.name}</span>
                      <span className="tabular-nums text-slate-600">
                        added {fmt.n(i.addedToTray)} · in {fmt.n(i.inOrders)} orders
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-500">Nothing stands out — dishes that get added get ordered.</p>
              )}
            </Panel>
            <Panel title="Not selling" subtitle="On the menu, no orders in this period">
              {notSelling.length ? (
                <ul className="divide-y divide-slate-100 text-[13px]">
                  {notSelling.slice(0, 8).map((i) => (
                    <li key={i.itemId} className="flex justify-between gap-3 py-2">
                      <span className="text-slate-800">
                        {i.name}
                        {i.category && <span className="ml-2 text-slate-400">{i.category}</span>}
                      </span>
                      <span className="tabular-nums text-slate-500">{i.addedToTray ? `added ${fmt.n(i.addedToTray)}×` : 'never added'}</span>
                    </li>
                  ))}
                  {notSelling.length > 8 && <li className="py-2 text-slate-500">and {notSelling.length - 8} more</li>}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-500">Every dish sold at least once.</p>
              )}
            </Panel>
          </div>

          <Panel
            title="Every dish"
            subtitle="Click a column to sort"
            right={
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes"
                className="w-44 rounded-lg border border-[#e5e5e5] px-2.5 py-1.5 text-[13px]"
              />
            }
          >
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-y border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {COLS.map((c) => (
                      <th key={c.key} title={c.hint} className={`px-4 py-2 font-semibold ${c.key === 'name' ? 'text-left' : 'text-right'}`}>
                        <button type="button" onClick={() => setSort(c.key)} className={sort === c.key ? 'text-slate-900' : 'hover:text-slate-700'}>
                          {c.label}
                          {sort === c.key && ' ↓'}
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right font-semibold">Dine-in / online</th>
                    <th className="px-4 py-2 text-right font-semibold">Last sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r: MenuInsight) => (
                    <tr key={r.itemId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        {r.category && <div className="text-[11px] text-slate-400">{r.category}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmt.n(r.qty)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <div>{fmt.money(r.revenue)}</div>
                        <div className="ml-auto mt-1 h-1 w-20 rounded-full bg-slate-100" title={`${fmt.pct(r.revenueShare)} of dish revenue`}>
                          <div className="h-1 rounded-full bg-[#2a78d6]" style={{ width: `${(r.revenue / maxRevenue) * 100}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt.pct(r.orderShare)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(r.addedToTray)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(r.byWaiter)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt.n(r.suggestedAdds)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {r.qty ? `${fmt.n(r.dineIn)} / ${fmt.n(r.online)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{since(r.lastSold)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={COLS.length + 2} className="px-4 py-8 text-center text-slate-500">
                        No dishes match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
