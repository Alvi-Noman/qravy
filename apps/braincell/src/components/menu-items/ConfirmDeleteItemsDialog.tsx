import { AnimatePresence, motion } from 'framer-motion';
import { useScope } from '../../context/ScopeContext';

type Scope = 'global' | 'branch';

export default function ConfirmDeleteItemsDialog({
  open,
  count,
  scope = 'global',
  onClose,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  count: number;
  scope?: Scope; // 'global' = delete everywhere, 'branch' = scoped to current location (and maybe channel)
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}) {
  const { activeLocationId, channel } = useScope();
  const isBranch = !!activeLocationId;
  const isChannelScoped = channel && channel !== 'all';
  const chanLabel = channel === 'dine-in' ? 'Dine‑In' : channel === 'online' ? 'Online' : '';

  const noun = count === 1 ? 'item' : 'items';

  // Title/description per scope
  let title = `Delete ${noun}`;
  let description =
    `Are you sure you want to delete ${count} ${noun}? This will remove them from all locations and channels. This action cannot be undone.`;
  let confirmLabel = 'Delete';
  let pendingLabel = 'Deleting…';
  const isDestructiveEverywhere = !isBranch && !isChannelScoped;

  if (isBranch && !isChannelScoped) {
    // Location only
    title = `Delete ${noun} from this location`;
    description = `Are you sure you want to delete ${count} ${noun} from this location? They will remain in other locations.`;
    confirmLabel = 'Delete';
    pendingLabel = 'Deleting…';
  } else if (!isBranch && isChannelScoped) {
    // Channel across all locations
    title = `Delete ${noun} from this channel`;
    description = `Are you sure you want to delete ${count} ${noun} from the ${chanLabel} channel across all locations? They will remain available in other channel(s).`;
    confirmLabel = 'Delete';
    pendingLabel = 'Deleting…';
  } else if (isBranch && isChannelScoped) {
    // Channel within this location
    title = `Delete ${noun} from this channel in this location`;
    description = `Are you sure you want to delete ${count} ${noun} from the ${chanLabel} channel in this location? They will remain in other channel(s) and/or locations.`;
    confirmLabel = 'Delete';
    pendingLabel = 'Deleting…';
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-lg border border-[#ececec] bg-white p-5 shadow-lg text-sm"
          >
            <div className="mb-4">
              <h3 className="text-base font-semibold text-[#2e2e30]">{title}</h3>
              <p className="text-[#6b6b70]">{description}</p>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-md border border-[#cecece] px-4 py-2 hover:bg-[#f5f5f5] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onConfirm}
                className={`rounded-md px-4 py-2 text-white hover:opacity-90 disabled:opacity-50 ${
                  isDestructiveEverywhere ? 'bg-red-600' : 'bg-[#2e2e30]'
                }`}
              >
                {isSubmitting ? pendingLabel : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}