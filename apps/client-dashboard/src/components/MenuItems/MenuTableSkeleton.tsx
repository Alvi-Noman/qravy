export default function MenuTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-[#ececec] bg-white">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#fafafa] text-[#5b5b5d]">
            <tr className="text-left">
              <th className="px-3 py-3 w-[5%]"></th>
              <th className="px-3 py-3 w-[40%]">Product</th>
              <th className="px-3 py-3 w-[20%]">Category</th>
              <th className="px-3 py-3 w-[15%]">Price</th>
              <th className="px-3 py-3 w-[10%]">Availability</th>
              <th className="px-3 py-3 w-[10%]"></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-t border-[#f2f2f2]">
                <td className="px-3 py-4 align-middle">
                  <div className="h-4 w-4 rounded bg-slate-200 animate-pulse" />
                </td>
                <td className="px-3 py-4 align-middle">
                  <div className="h-4 w-56 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-2 h-3 w-40 rounded bg-slate-100 animate-pulse" />
                </td>
                <td className="px-3 py-4 align-middle">
                  <div className="h-5 w-24 rounded-full bg-slate-100 animate-pulse" />
                </td>
                <td className="px-3 py-4 align-middle">
                  <div className="h-4 w-16 rounded bg-slate-200 animate-pulse" />
                </td>
                <td className="px-3 py-4 align-middle">
                  <div className="h-6 w-11 rounded-full bg-slate-100 animate-pulse" />
                </td>
                <td className="px-3 py-4 align-middle text-right">
                  <div className="ml-auto h-7 w-7 rounded bg-slate-200 animate-pulse" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}