// apps/braincell/src/components/insights/Charts.tsx — the Insights pages' charts and tiles.
// One measure per chart (no dual axes), one hue (#2a78d6, validated against the light surface), thin marks, a recessive
// grid, a tooltip on every chart; numbers stay in text ink.
import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const SERIES = '#2a78d6';
const GRID = '#e7e5e4';
const AXIS = '#52514e';

export const fmt = {
  n: (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US')),
  money: (v: number | null | undefined) => (v == null ? '—' : `৳${Math.round(v).toLocaleString('en-US')}`),
  pct: (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`),
  /** axis ticks: 12000 → 12k */
  short: (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v)),
  min: (v: number | null | undefined) => (v == null ? '—' : v < 1 ? `${Math.round(v * 60)}s` : `${v.toFixed(1)} min`),
};

export function Panel({ title, subtitle, children, right, className = '' }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[#ececec] bg-white p-5 shadow-sm ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-[26px] font-semibold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Tip({ active, payload, label, unit, labelFmt }: { active?: boolean; payload?: Array<{ value: number }>; label?: string | number; unit: (v: number) => string; labelFmt: (l: string | number) => string }) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] shadow-sm">
      <div className="text-slate-500">{labelFmt(label)}</div>
      <div className="font-semibold text-slate-900">{unit(Number(payload[0].value))}</div>
    </div>
  );
}

const dayLabel = (d: string | number) => new Date(String(d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** A measure day by day. */
export function TrendChart({ data, field, unit = (v) => v.toLocaleString('en-US'), height = 170 }: { data: Array<Record<string, number | string>>; field: string; unit?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id={`ins-${field}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} width={40} tickFormatter={fmt.short} />
          <Tooltip content={<Tip unit={unit} labelFmt={dayLabel} />} cursor={{ stroke: AXIS, strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey={field} stroke={SERIES} strokeWidth={2} fill={`url(#ins-${field})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Counts per bucket (hour of day, weekday): thin bars, rounded tops. */
export function BarsChart({ data, x, field, xFmt = String, unit = (v) => v.toLocaleString('en-US'), height = 170 }: { data: Array<Record<string, number | string>>; x: string; field: string; xFmt?: (v: string | number) => string; unit?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={xFmt} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} width={40} tickFormatter={fmt.short} />
          <Tooltip content={<Tip unit={unit} labelFmt={xFmt} />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
          <Bar dataKey={field} fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The guest funnel: count, share of the first step, share of the step before. */
export function Funnel({ steps }: { steps: Array<{ label: string; value: number; hint?: ReactNode }> }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label} title={`${s.label}: ${s.value.toLocaleString('en-US')}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-medium text-slate-800">{s.label}</span>
              <span className="tabular-nums text-slate-600">
                <span className="font-semibold text-slate-900">{s.value.toLocaleString('en-US')}</span>
                <span className="ml-1.5">{((s.value / top) * 100).toFixed(0)}%</span>
                {prev != null && prev > 0 && s.value <= prev && <span className="ml-1.5 text-slate-400">({((s.value / prev) * 100).toFixed(0)}% of previous)</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100">
              <div className="h-2.5 rounded-full" style={{ width: `${Math.max((s.value / top) * 100, s.value ? 1.5 : 0)}%`, background: SERIES }} />
            </div>
            {s.hint && <div className="mt-0.5 text-[11px] text-slate-400">{s.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Parts of a whole (dine-in vs online …). */
export function Split({ parts }: { parts: Array<{ label: string; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {parts.map((p) => (
        <li key={p.label} title={`${p.label}: ${p.value.toLocaleString('en-US')}`}>
          <div className="mb-1 flex justify-between text-[12px]">
            <span className="text-slate-700">{p.label}</span>
            <span className="tabular-nums font-semibold text-slate-900">
              {p.value.toLocaleString('en-US')} <span className="font-normal text-slate-500">· {((p.value / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${(p.value / total) * 100}%`, background: SERIES }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Period({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e5e5] bg-white p-0.5 text-[13px]" role="group" aria-label="Period">
      {[
        [1, 'Today'],
        [7, '7 days'],
        [30, '30 days'],
        [90, '90 days'],
      ].map(([d, l]) => (
        <button key={d} type="button" onClick={() => onChange(Number(d))} className={`rounded-md px-3 py-1.5 ${value === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ the home dashboard */

export const DINE_IN = SERIES;
export const ONLINE = '#e8833a'; // validated with SERIES (CVD ΔE 26); its numbers are always shown as text too
const PREV = '#a8a29e';

/** Change against the previous period: "▲ 12%" — green when it's good, red when it isn't (a rising bounce rate is bad). */
export function Delta({ now, before, upIsGood = true, points = false }: { now: number | null; before: number | null; upIsGood?: boolean; points?: boolean }) {
  if (now == null || before == null) return null;
  if (before === 0 && now === 0) return <span className="text-[11px] text-slate-400">no change</span>;
  if (before === 0 && !points) return <span className="text-[11px] font-medium text-slate-500">new</span>;
  // rates change in percentage points ("+4 pts"), counts in percent
  const change = points ? (now - before) * 100 : ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(change) < 0.5) return <span className="text-[11px] text-slate-400">no change</span>;
  const good = change > 0 === upIsGood;
  return (
    <span className={`text-[11px] font-semibold ${good ? 'text-emerald-700' : 'text-red-700'}`} title="Compared with the previous period">
      {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}
      {points ? ' pts' : '%'}
    </span>
  );
}

/** A number, its change against the previous period, and what it means. */
export function StatTile({ label, value, delta, hint, icon }: { label: string; value: ReactNode; delta?: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[24px] font-semibold tracking-tight text-slate-900">{value}</span>
        {delta}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-slate-500">{hint}</div>}
    </div>
  );
}

function CompareTip({ active, payload, label, unit, labelFmt }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string; unit: (v: number) => string; labelFmt: (l: string) => string }) {
  if (!active || !payload?.length || label == null) return null;
  const cur = payload.find((p) => p.dataKey === 'now')?.value;
  const prev = payload.find((p) => p.dataKey === 'before')?.value;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] shadow-sm">
      <div className="text-slate-500">{labelFmt(label)}</div>
      <div className="font-semibold text-slate-900">{cur == null ? '—' : unit(cur)}</div>
      {prev != null && <div className="text-slate-500">previous period: {unit(prev)}</div>}
    </div>
  );
}

/** One measure over time, with the previous period laid over it (dashed, grey). */
export function CompareChart({ data, xFmt, unit = (v) => v.toLocaleString('en-US'), height = 220 }: { data: Array<{ x: string; now: number; before: number }>; xFmt: (x: string) => string; unit?: (v: number) => string; height?: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[12px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES }} /> This period
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: PREV }} /> Previous period
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={xFmt} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} width={40} tickFormatter={fmt.short} />
            <Tooltip content={<CompareTip unit={unit} labelFmt={xFmt} />} cursor={{ stroke: AXIS, strokeWidth: 1, strokeDasharray: '3 3' }} />
            <Line type="monotone" dataKey="before" stroke={PREV} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="now" stroke={SERIES} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChannelTip({ active, payload, label, labelFmt }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string; labelFmt: (l: string) => string }) {
  if (!active || !payload?.length || label == null) return null;
  const v = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] shadow-sm">
      <div className="text-slate-500">{labelFmt(label)}</div>
      <div className="flex items-center gap-1.5 text-slate-900">
        <span className="h-2 w-2 rounded-sm" style={{ background: DINE_IN }} /> Dine-in <b className="ml-auto pl-3">{v('dineIn')}</b>
      </div>
      <div className="flex items-center gap-1.5 text-slate-900">
        <span className="h-2 w-2 rounded-sm" style={{ background: ONLINE }} /> Online <b className="ml-auto pl-3">{v('online')}</b>
      </div>
    </div>
  );
}

/** Dine-in and online side by side over time (two bars per point, a 2px gap between them). */
export function ChannelBars({ data, xFmt, height = 200 }: { data: Array<{ x: string; dineIn: number; online: number }>; xFmt: (x: string) => string; height?: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[12px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DINE_IN }} /> Dine-in
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ONLINE }} /> Online
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={xFmt} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} width={40} tickFormatter={fmt.short} />
            <Tooltip content={<ChannelTip labelFmt={xFmt} />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
            <Bar dataKey="dineIn" fill={DINE_IN} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="online" fill={ONLINE} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
