export default function LocationsToolbarSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2" />
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[320px] max-w-[680px] flex-1 items-center">
          <div className="h-10 w-full min-w-[320px] animate-pulse rounded-md border border-slate-200 bg-slate-100" />
          <div className="ml-2 h-10 w-40 animate-pulse rounded-md border border-slate-200 bg-slate-100" />
        </div>
      </div>
    </div>
  );
}