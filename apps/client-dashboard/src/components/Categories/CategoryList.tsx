import type { Category } from '../../api/categories';
import CategoryRow from './CategoryRow';

export default function CategoryList({
  categories,
  usageByName,
  activeByName,
  toggling,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onToggleAvailability,
  onEdit,
  onDelete,
}: {
  categories: Category[];
  usageByName: Map<string, number>;
  activeByName: Map<string, boolean>;
  toggling: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleAvailability: (category: Category, active: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}) {
  const allSelected = categories.length > 0 && categories.every((c) => selectedIds.has(c.id));

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
              <th className="px-3 py-3 w-[45%]">Category</th>
              <th className="px-3 py-3 w-[15%]">Usage</th>
              <th className="px-3 py-3 w-[15%]">Availability</th>
              <th className="px-3 py-3 w-[20%] text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const usageCount = usageByName.get(c.name) ?? 0;
              const active = activeByName.get(c.name) ?? false;
              return (
                <CategoryRow
                  key={c.id}
                  category={c}
                  usageCount={usageCount}
                  selected={selectedIds.has(c.id)}
                  active={active}
                  disabled={toggling || usageCount === 0}
                  onToggleSelect={onToggleSelect}
                  onToggleAvailability={onToggleAvailability}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              );
            })}
            {categories.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-[#6b7280]">
                  No categories match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}