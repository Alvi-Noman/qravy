export default function BulkActionsBar({
  count,
  onClear,
  onMerge,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-40 mx-auto w-fit rounded-full border border-[#ececec] bg-white px-3 py-2 shadow-md text-sm text-[#2e2e30]">
      <div className="flex items-center gap-3">
        <div>
          <span className="font-medium">{count}</span> selected
        </div>
        <button
          className="rounded-md border border-[#cecece] px-3 py-1.5 text-sm hover:bg-[#f5f5f5]"
          onClick={onMerge}
        >
          Merge
        </button>
        <button
          className="rounded-md border border-[#cecece] px-3 py-1.5 text-sm text-red-600 hover:bg-[#fff0f0]"
          onClick={onDelete}
        >
          Delete / Reassign
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-sm text-[#6b6b70] hover:bg-[#f5f5f5]"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
    </div>
  );
}