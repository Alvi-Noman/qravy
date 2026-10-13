// apps/cortex/src/components/ui.tsx — Cortex's small building blocks: cards, stat tiles, tables, formatting.
import type { ReactNode } from 'react';

export const fmt = {
  n: (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US')),
  money: (v: number | null | undefined) =>
    v == null ? '—' : `৳${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
  pct: (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`),
  min: (v: number | null | undefined) => (v == null ? '—' : v < 1 ? `${Math.round(v * 60)}s` : `${v.toFixed(1)} min`),
  date: (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  time: (s: string | null | undefined) =>
    s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
  ago: (s: string | null | undefined) => {
    if (!s) return '—';
    const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  },
};

export function Card({ title, subtitle, children, right, className = '' }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[14px] font-semibold text-stone-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] text-stone-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** A stat tile: the headline number, what it is, and an optional line under it. */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] font-medium text-stone-500">{label}</div>
      <div className={`mt-1 text-[24px] font-semibold tracking-tight ${tone === 'bad' ? 'text-red-700' : 'text-stone-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-stone-500">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  const t = {
    neutral: 'bg-stone-100 text-stone-700',
    good: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-900',
    bad: 'bg-red-50 text-red-800',
    info: 'bg-sky-50 text-sky-800',
  }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export function DaysSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-[13px]" role="group" aria-label="Period">
      {[1, 7, 30, 90].map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={`rounded-md px-3 py-1.5 ${value === d ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`}
        >
          {d === 1 ? 'Today' : `${d} days`}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <div className="p-8 text-center text-sm text-stone-500">Loading…</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{(error as Error)?.message || 'Something went wrong'}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{children}</div>;
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
export function Td({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2.5 text-[13px] ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>;
}
