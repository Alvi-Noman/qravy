import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function BulkChangeCategoryDialog({
  open,
  categories,
  onClose,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  categories: string[];
  onClose: () => void;
  onConfirm: (category?: string) => void;
  isSubmitting?: boolean;
}) {
  const [value, setValue] = useState<string>('');
  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[1000] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-lg border border-[#ececec] bg-white p-5 shadow-lg text-sm"
          >
            <div className="mb-4">
              <h3 className="text-base font-semibold text-[#2e2e30]">Change category</h3>
              <p className="text-[#6b6b70]">Select a category to assign to the selected items.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[#5b5b5d]">Category</label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border border-[#cecece] bg-white px-3 py-2"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-md border border-[#cecece] px-4 py-2 hover:bg-[#f5f5f5] disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onConfirm(value || undefined)}
                className="rounded-md bg-[#2e2e30] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Updating…' : 'Update'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}