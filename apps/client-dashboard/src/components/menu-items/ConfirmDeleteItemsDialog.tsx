import { AnimatePresence, motion } from 'framer-motion';

export default function ConfirmDeleteItemsDialog({
  open,
  count,
  onClose,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}) {
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
              <h3 className="text-base font-semibold text-[#2e2e30]">Delete items</h3>
              <p className="text-[#6b6b70]">Are you sure you want to delete {count} item{count > 1 ? 's' : ''}? This action cannot be undone.</p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-md border border-[#cecece] px-4 py-2 hover:bg-[#f5f5f5] disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onConfirm}
                className="rounded-md bg-red-600 px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}