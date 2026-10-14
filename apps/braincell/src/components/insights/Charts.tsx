// apps/braincell/src/components/insights/Charts.tsx — the Insights pages' charts and tiles.
// One measure per chart (no dual axes), one hue (#2a78d6, validated against the light surface), thin marks, a recessive
// grid, a tooltip on every chart; numbers stay in text ink.
import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
