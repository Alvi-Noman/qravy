import type { MenuItem as TMenuItem } from '../../api/menuItems';
import MenuRow from './MenuRow';

export default function MenuTable({
  items,
  highlightId,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onToggleAvailability,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  items: TMenuItem[];
  highlightId?: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleAvailability: (id: string, active: boolean) => void;
  onEdit: (item: TMenuItem) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const allSelected = items.length > 0 && items.every((it) => selectedIds.has(it.id));

  return (
    <div className="rounded-lg border border-[#ececec] bg-white">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#fafafa] text-[#5b5b5d]">
            <tr className="text-left">
              <th className="px-3 py-3 w-[5%]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all"
                  className="h-4 w-4 rounded border-[#cecece] text-[#2e2e30] focus:ring-[#2e2e30]"
                />
              </th>
              <th className="px-3 py-3 w-[40%]">Product</th>
              <th className="px-3 py-3 w-[20%]">Category</th>
              <th className="px-3 py-3 w-[15%]">Price</th>
              <th className="px-3 py-3 w-[10%]">Availability</th>
              <th className="px-3 py-3 w-[10%] text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const isNew = it.id === highlightId; // reuse same prop for highlight
              return (
                <MenuRow
                  key={it.id}
                  item={it}
                  selected={selectedIds.has(it.id)}
                  isNew={isNew}
                  onToggleSelect={onToggleSelect}
                  onToggleAvailability={onToggleAvailability}
                  onEdit={onEdit}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              );
            })}

            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-[#6b7280]">
                  No items match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}