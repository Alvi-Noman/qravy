import React from 'react';

export default function SidebarSkeleton(): JSX.Element {
  return (
    <aside className="flex h-full w-64 flex-col bg-[#f5f5f5] px-4 py-4 animate-pulse" aria-hidden="true">
      {/* Brand */}
      <div className="mb-0 flex items-center">
        <div className="h-8 w-28 rounded bg-slate-200" />
      </div>

      {/* Branch selector */}
      <div className="mt-7 mb-6">
        <div className="flex w-full items-center justify-between rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <div className="h-5 w-5 rounded bg-slate-200" />
            <div className="h-4 w-32 rounded bg-slate-200" />
          </span>
          <span className="ml-2 grid h-5 w-5 place-items-center rounded-full bg-slate-100">
            <div className="h-3 w-3 rounded-full bg-slate-200" />
          </span>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto">
        <SectionSkeleton headingWidth="w-16" rows={10} />
        <SectionSkeleton headingWidth="w-20" rows={2} />
      </nav>
    </aside>
  );
}

function SectionSkeleton({ rows = 6, headingWidth = 'w-24' }: { rows?: number; headingWidth?: string }) {
  return (
    <div className="mb-6">
      <div className={`mb-3 h-3 ${headingWidth} rounded bg-slate-200`} />
      <ul className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i}>
            <div className="group flex items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2.5">
              <div className="h-5 w-5 rounded bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-200" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}