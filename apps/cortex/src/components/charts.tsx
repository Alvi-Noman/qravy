// apps/cortex/src/components/charts.tsx — Cortex's charts.
// One series per chart (two measures of different scale are two charts, never a dual axis); one hue (the
// reference palette's slot 1); 2px lines, recessive grid, a hover tooltip on every chart; numbers in text ink.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';

const SERIES = 'var(--series-1)';

type Point = Record<string, number | string>;

function TipBox({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; unit: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] shadow-sm">
      <div className="text-stone-500">{label ? new Date(label).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</div>
      <div className="font-semibold text-stone-900">{unit(Number(payload[0].value))}</div>
    </div>
  );
}

/** A day-by-day line (with a soft fill) for one measure. */
export function Trend({ data, field, unit = (v) => v.toLocaleString('en-US'), height = 160 }: { data: Point[]; field: string; unit?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${field}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} width={44} />
          <Tooltip content={<TipBox unit={unit} />} cursor={{ stroke: 'var(--text-secondary)', strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey={field} stroke={SERIES} strokeWidth={2} fill={`url(#fill-${field})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The guest funnel: each step's count, its share of the first step, and the drop from the step before. */
export function FunnelBars({ steps }: { steps: Array<{ label: string; value: number; hint?: ReactNode }> }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const share = s.value / top;
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label} className="group" title={`${s.label}: ${s.value.toLocaleString('en-US')}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-medium text-stone-800">{s.label}</span>
              <span className="tabular-nums text-stone-600">
                <span className="font-semibold text-stone-900">{s.value.toLocaleString('en-US')}</span>
                <span className="ml-1.5">{(share * 100).toFixed(0)}%</span>
                {prev != null && prev > 0 && s.value <= prev && <span className="ml-1.5 text-stone-400">({((s.value / prev) * 100).toFixed(0)}% of previous)</span>}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-stone-100">
              <div className="h-2.5 rounded-full transition-all group-hover:opacity-80" style={{ width: `${Math.max(share * 100, s.value ? 1.5 : 0)}%`, background: SERIES }} />
            </div>
            {s.hint && <div className="mt-0.5 text-[11px] text-stone-400">{s.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** A share split (e.g. dine-in vs online): one bar per part, labelled. */
export function Split({ parts }: { parts: Array<{ label: string; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <ul className="space-y-2">
      {parts.map((p) => (
        <li key={p.label} title={`${p.label}: ${p.value.toLocaleString('en-US')}`}>
          <div className="mb-1 flex justify-between text-[12px]">
            <span className="text-stone-700">{p.label}</span>
            <span className="tabular-nums font-semibold text-stone-900">
              {p.value.toLocaleString('en-US')} <span className="font-normal text-stone-500">· {((p.value / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100">
            <div className="h-2 rounded-full" style={{ width: `${(p.value / total) * 100}%`, background: SERIES }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
