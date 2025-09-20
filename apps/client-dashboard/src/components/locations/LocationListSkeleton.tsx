export default function LocationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-[#ececec] bg-white">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#fafafa] text-[#5b5b5d]">
            <tr className="text-left">
              <th className="w-[35%] px-3 py-3">Location</th>
              <th className="w-[30%] px-3 py-3">Address</th>
              <th className="w-[15%] px-3 py-3">Zip/Postal</th>
              <th className="w-[15%] px-3 py-3">Country</th>
              <th className="w-[10%] px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-t border-[#f2f2f2]">
                <td className="px-3 py-3 align-middle">
                  <div className="h-4 w-56 animate-pulse rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100" />
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className="h-4 w-64 animate-pulse rounded bg-slate-200" />
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                </td>
                <td className="px-3 py-3 align-middle text-right">
                  <div className="ml-auto h-7 w-7 animate-pulse rounded bg-slate-200" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}