import { useState } from 'react';
import AvailabilityEditor, {
  validateAvailability,
  type AvailabilityValue,
} from '../availability/AvailabilityEditor';

/**
 * Set availability on several items at once (e.g. put all morning items on "Breakfast").
 * Saving with nothing selected clears it (they follow their category again).
 */
export default function BulkHoursDialog({
  count,
  saving,
  onClose,
  onApply,
}: {
  count: number;
  saving?: boolean;
  onClose: () => void;
  onApply: (v: Pick<AvailabilityValue, 'servicePeriodIds' | 'availability'>) => void;
}) {
  const [value, setValue] = useState<AvailabilityValue>({ servicePeriodIds: [], availability: [] });
  const [error, setError] = useState<string | null>(null);
  const empty = !value.servicePeriodIds.length && !value.availability.length;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[#ececec] bg-white p-5 shadow-lg">
        <h3 className="text-lg font-semibold text-[#2e2e30]">Availability</h3>
        <p className="mb-4 mt-1 text-sm text-[#6b6b70]">
          For the {count} selected item{count === 1 ? '' : 's'}. This replaces their current availability.
        </p>

        <AvailabilityEditor
          value={value}
          onChange={(v) => {
            setValue(v);
            if (error) setError(validateAvailability(v));
          }}
          error={error}
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#dbdbdb] px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f6f6f6]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const err = validateAvailability(value);
              setError(err);
              if (!err) onApply({ servicePeriodIds: value.servicePeriodIds, availability: value.availability });
            }}
            className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : empty ? 'Clear availability' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
