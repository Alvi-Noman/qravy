import { useScope } from '../../context/ScopeContext';

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
  const { activeLocationId, channel } = useScope();
  const isBranchView = !!activeLocationId;
  const isChannelScoped = channel && channel !== 'all';

  if (count === 0) return null;

  const baseBtn = 'rounded-md border border-[#cecece] px-3 py-1.5 text-sm';
  const isDestructive = !isBranchView && !isChannelScoped; // All locations + All channels
  const deleteBtnClass = isDestructive ? `${baseBtn} text-red-600 hover:bg-[#fff0f0]` : `${baseBtn} hover:bg-[#f5f5f5]`;

  const deleteLabel =
    !isBranchView && !isChannelScoped
      ? 'Delete / Reassign everywhere'
      : !isBranchView && isChannelScoped
      ? 'Delete / Reassign from this channel'
      : isBranchView && !isChannelScoped
      ? 'Delete / Reassign from this location'
      : 'Delete / Reassign from this channel in this location';

  return (
    <div className="sticky bottom-4 z-40 mx-auto w-fit rounded-full border border-[#ececec] bg-white px-3 py-2 shadow-md text-sm text-[#2e2e30]">
      <div className="flex items-center gap-3">
        <div>
          <span className="font-medium">{count}</span> selected
        </div>
        <button
          className={`${baseBtn} hover:bg-[#f5f5f5]`}
          onClick={onMerge}
        >
          Merge
        </button>
        <button
          className={deleteBtnClass}
          onClick={onDelete}
        >
          {deleteLabel}
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