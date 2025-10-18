import { Fragment } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Location } from '../../api/locations';

export default function DeleteLocationDialog({
  open,
  location,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  location: Location | null;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open || !location) return null;
  return (
    <Fragment>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">Delete location</h3>
            <button
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              onClick={onClose}
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-4 text-sm text-slate-700">
            Are you sure you want to delete “{location.name}”? This action cannot be undone.
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </Fragment>
  );
}