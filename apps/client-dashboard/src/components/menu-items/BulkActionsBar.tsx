export default function BulkActionsBar({
  count,
  onSetAvailable,
  onSetUnavailable,
  onAssignCategory,
  onDelete,
  onClear,
}: {
  count: number;
  onSetAvailable: () => void;
  onSetUnavailable: () => void;
  onAssignCategory: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-40 mx-auto w-fit rounded-full border border-[#ececec] bg-white px-3 py-2 shadow-md text-sm text-[#2e2e30]">
      <div className="flex items-center gap-3">
        <div>
          <span className="font-medium">{count}</span> selected
        </div>
        <button className="rounded-md border border-[#cecece] px-3 py-1.5 hover:bg-[#f5f5f5]" onClick={onSetAvailable}>
          Set Available
        </button>
        <button className="rounded-md border border-[#cecece] px-3 py-1.5 hover:bg-[#f5f5f5]" onClick={onSetUnavailable}>
          Set Unavailable
        </button>
        <button className="rounded-md border border-[#cecece] px-3 py-1.5 hover:bg-[#f5f5f5]" onClick={onAssignCategory}>
          Assign Category
        </button>
        <button className="rounded-md border border-[#cecece] px-3 py-1.5 text-red-600 hover:bg-[#fff0f0]" onClick={onDelete}>
          Delete
        </button>
        <button className="rounded-md px-3 py-1.5 text-[#6b6b70] hover:bg-[#f5f5f5]" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}