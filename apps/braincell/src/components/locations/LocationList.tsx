import type { Location } from '../../api/locations';
import LocationRow from './LocationRow';

type Props = {
  locations: Location[];
  highlightId?: string | null;
  defaultLocationId: string | null;
  onToggleDefault: (location: Location) => void;
  onEdit: (location: Location) => void;
  onDelete: (location: Location) => void;
};

export default function LocationList({
  locations,
  highlightId,
  defaultLocationId,
  onToggleDefault,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div className="rounded-lg border border-[#ececec] bg-white">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full table-fixed text-sm">
          <thead className="bg-[#fafafa] text-[#5b5b5d]">
            <tr className="text-left">
              {/* Default pin column */}
              <th className="w-[40px] px-3 py-3 text-center">
                <span className="sr-only">Default</span>
              </th>
              <th className="w-[28%] px-3 py-3">Location</th>
              <th className="w-[42%] px-3 py-3">Address</th>
              <th className="w-[12%] px-3 py-3">ZIP/Postal</th>
              <th className="w-[12%] px-3 py-3">Country</th>
              <th className="w-[6%] px-3 py-3 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <LocationRow
                key={l.id}
                location={l}
                isNew={highlightId === l.id}
                isDefault={defaultLocationId === l.id}
                onToggleDefault={onToggleDefault}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
            {locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-[#6b7280]">
                  No locations match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}