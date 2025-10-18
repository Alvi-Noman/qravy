import { Fragment } from 'react';
import { XMarkIcon, MapPinIcon } from '@heroicons/react/24/outline';

export default function RemoveDefaultDialog({
  open,
  locationName,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  locationName: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || !locationName) return null;
  return (
    <Fragment>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900">
                <MapPinIcon className="h-4 w-4 text-white" />
              </span>
              Remove default location
            </h3>
            <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onCancel} aria-label="Close" disabled={isSubmitting}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="px-4 py-4 text-sm text-slate-700">
            Removing your default means Qravy will open “All locations” first. You can pin a location again anytime.
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </button>
            <button className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50" onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? 'Removing…' : 'Remove default'}
            </button>
          </div>
        </div>
      </div>
    </Fragment>
  );
}