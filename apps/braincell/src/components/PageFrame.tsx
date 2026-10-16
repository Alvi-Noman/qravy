// apps/braincell/src/components/PageFrame.tsx — the frame every list page has (as Menu Items and Categories): a sticky
// header bar with the title (and a badge) on the left and the page's buttons on the right, then the page, padded.
import type { ReactNode } from 'react';

/** Outlined header button (the dark one is `PRIMARY_BUTTON`). */
export const HEADER_BUTTON =
  'inline-flex items-center gap-2 rounded-md border border-[#cecece] bg-white px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]';
export const PRIMARY_BUTTON = 'inline-flex items-center gap-2 rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90';

export default function PageFrame({
  title,
  badge,
  actions,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto text-sm text-[#2e2e30]">
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#ececec] bg-[#fcfcfc]/90 px-6 py-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-lg font-semibold text-[#2e2e30]">{title}</h2>
            {badge}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <div className="space-y-4 px-6 pb-10 pt-4">{children}</div>
      </div>
    </div>
  );
}

/** Live / Reconnecting — the board's connection to new orders and calls. */
export function LiveBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ${
        connected ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-500 ring-slate-200'
      }`}
      title={connected ? 'New orders and table calls appear instantly' : 'Reconnecting…'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}

/** A two-or-more-choice switch (Active / Last 48 hours, All / Dine-in / …) — the same look everywhere. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: ReactNode }>;
  label: string;
}) {
  return (
    <div className="flex w-fit flex-wrap gap-1 rounded-lg border border-[#ececec] bg-[#f6f6f7] p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === o.id ? 'bg-white font-medium text-[#2e2e30] shadow-sm' : 'text-[#6b6b70] hover:text-[#2e2e30]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
