import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Category } from '../../api/categories';

export default function MergeCategoriesDialog({
  open,
  selectedIds,
  categories,
  onClose,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  selectedIds: string[];
  categories: Category[];
  onClose: () => void;
  onConfirm: (opts: { fromIds: string[]; toId: string }) => void;
  isSubmitting?: boolean;
}) {
  const selected = useMemo(
    () => categories.filter((c) => selectedIds.includes(c.id)),
    [categories, selectedIds]
  );
  const [toId, setToId] = useState<string>('');

  useEffect(() => {
    setToId('');
  }, [open, selectedIds.join(',')]);

  if (!open) return null;

  const options = categories.filter((c) => !selectedIds.includes(c.id));
  const headingId = 'merge-categories-title';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-lg rounded-lg border border-[#ececec] bg-white p-5 shadow-lg text-sm text-[#2e2e30]"
          >
            <div className="mb-4">
              <h3 id={headingId} className="text-base font-semibold text-[#2e2e30]">
                Merge categories
              </h3>
              <p className="text-[#6b6b70]">
                Merge {selected.length} categor{selected.length > 1 ? 'ies' : 'y'} into one.
              </p>
            </div>

            <div className="mb-3">
              <div className="text-sm text-[#5b5b5d]">Selected</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {selected.map((c) => (
                  <span
                    key={c.id}
                    className="rounded-full bg-[#f1f2f4] px-2 py-0.5 text-xs text-[#44464b]"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[#5b5b5d]" htmlFor="merge-into">
                Merge into
              </label>
              <select
                id="merge-into"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                className="w-full rounded-md border border-[#cecece] bg-white px-3 py-2 text-sm text-[#2e2e30]"
              >
                <option value="" disabled>
                  Select target category
                </option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-md border border-[#cecece] px-4 py-2 text-sm hover:bg-[#f5f5f5] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => toId && onConfirm({ fromIds: selectedIds, toId })}
                disabled={isSubmitting || !toId}
                className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}