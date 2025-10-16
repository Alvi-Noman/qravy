export default function CategoriesToolbarSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Channels capsule */}
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-100 p-1">
          <div className="h-7 w-24 rounded-md bg-slate-200 animate-pulse" />
          <div className="h-7 w-20 rounded-md bg-slate-200 animate-pulse" />
          <div className="h-7 w-20 rounded-md bg-slate-200 animate-pulse" />
        </div>
      </div>

      {/* Right side: search + sort */}
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[320px] max-w-[680px] flex-1 items-center">
          <div className="h-10 w-full min-w-[320px] rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
          <div className="ml-2 h-10 w-40 rounded-md border border-slate-200 bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}