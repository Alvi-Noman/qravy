import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Category } from '../../api/categories';
import { useScope } from '../../context/ScopeContext';

type ConfirmPayload =
  | { scope: 'branch' } // remove from this location (and possibly channel)
  | { scope: 'global'; mode: 'cascade' | 'reassign'; reassignToId?: string }; // global (everywhere or channel-only)

export default function DeleteReassignDialog({
  open,
  category,
  categories,
  usageCount,
  scope = 'global', // 'global' | 'branch'
  onClose,
  onConfirm,
  isSubmitting = false,
}: {
  open: boolean;
  category: Category | null;
  categories: Category[];
  usageCount: number;
  scope?: 'global' | 'branch';
  onClose: () => void;
  onConfirm: (opts: ConfirmPayload) => void;
  isSubmitting?: boolean;
}) {
  const [mode, setMode] = useState<'cascade' | 'reassign'>('cascade');
  const [toId, setToId] = useState<string>('');

  const isBranchScope = scope === 'branch';

  const others = useMemo(
    () => (category ? categories.filter((c) => c.id !== category.id) : []),
    [categories, category]
  );
  const canReassign = usageCount > 0 && others.length > 0;

  useEffect(() => {
    if (!open || !category) return;
    setMode(canReassign ? 'reassign' : 'cascade');
    setToId('');
  }, [open, category?.id, canReassign]);

  if (!category) return null;

  // Channel hint + context
  const { activeLocationId, channel } = useScope();
  const isChannelScoped = channel && channel !== 'all';
  const chanLabel = channel === 'dine-in' ? 'Dine‑In' : channel === 'online' ? 'Online' : '';
  const headingId = 'delete-category-title';

  // Determine if this is channel-only delete across all locations (global + channel)
  const isGlobalChannelOnly = !isBranchScope && isChannelScoped;

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
          <motion.form
            onSubmit={(e) => {
              e.preventDefault();
              if (isSubmitting) return;

              if (isBranchScope) {
                onConfirm({ scope: 'branch' });
                return;
              }

              // For channel-only (global + channel), no reassign/cascade concept applies on client;
              // just proceed (we'll pass 'cascade' to keep shape consistent; useCategories ignores it for channel deletes)
              if (isGlobalChannelOnly) {
                onConfirm({ scope: 'global', mode: 'cascade' });
                return;
              }

              if (mode === 'reassign' && !toId) return;
              onConfirm({ scope: 'global', mode, reassignToId: mode === 'reassign' ? toId : undefined });
            }}
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-lg rounded-lg border border-[#ececec] bg-white p-5 shadow-lg text-sm text-[#2e2e30]"
          >
            <div className="mb-4">
              <h3 id={headingId} className="text-base font-semibold text-[#2e2e30]">
                {isBranchScope
                  ? `Remove from this location${isChannelScoped ? ` (${chanLabel})` : ''}`
                  : isGlobalChannelOnly
                  ? `Delete “${category.name}” from this channel`
                  : `Delete “${category.name}”`}
              </h3>

              {isBranchScope ? (
                <p className="text-[#6b6b70]">
                  This will hide the “{category.name}” category in this location
                  {isChannelScoped ? ` (${chanLabel})` : ''}. Products remain intact. You can show the category again later.
                </p>
              ) : isGlobalChannelOnly ? (
                <p className="text-[#6b6b70]">
                  This will delete the “{category.name}” category from the {chanLabel} channel across all locations.
                  Products in this category remain under the other channel(s).
                </p>
              ) : (
                <p className="text-[#6b6b70]">
                  {usageCount > 0
                    ? `This category has ${usageCount} linked product${usageCount > 1 ? 's' : ''}. Choose what to do with them.`
                    : 'This category has no linked products.'}
                </p>
              )}
            </div>

            {/* Global + all channels (everywhere) → show cascade/reassign options.
                Global + channel-only → skip options (simple confirm). */}
            {!isBranchScope && !isGlobalChannelOnly ? (
              <div className="space-y-4">
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="delete-mode"
                    value="cascade"
                    checked={mode === 'cascade'}
                    onChange={() => setMode('cascade')}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-[#2e2e30]">Delete category everywhere</div>
                    <div className="text-[#6b7280]">
                      {usageCount > 0
                        ? 'Also deletes the linked products (cascade).'
                        : 'No linked products to delete.'}
                    </div>
                  </div>
                </label>

                <div className={`flex items-start gap-3 ${!canReassign ? 'opacity-60' : ''}`}>
                  <input
                    type="radio"
                    name="delete-mode"
                    value="reassign"
                    checked={mode === 'reassign'}
                    onChange={() => canReassign && setMode('reassign')}
                    className="mt-1"
                    disabled={!canReassign}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-[#2e2e30]">Reassign products, then delete everywhere</div>
                    <div className="mt-2">
                      <select
                        disabled={mode !== 'reassign' || !canReassign}
                        value={toId}
                        onChange={(e) => setToId(e.target.value)}
                        className="w-full rounded-md border border-[#cecece] bg-white px-3 py-2 text-sm text-[#2e2e30] disabled:opacity-50"
                      >
                        <option value="" disabled>
                          {canReassign ? 'Select category to move products to' : 'No categories available'}
                        </option>
                        {others.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {!canReassign && usageCount > 0 ? (
                        <div className="mt-2 text-[13px] text-[#6b6b70]">
                          Create another category to move products to, or choose Delete (cascade).
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

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
                type="submit"
                disabled={isSubmitting || (!isBranchScope && !isGlobalChannelOnly && mode === 'reassign' && !toId)}
                className={`rounded-md px-4 py-2 text-sm text-white ${
                  !isBranchScope && !isGlobalChannelOnly ? 'bg-red-600 hover:opacity-90' : 'bg-[#2e2e30] hover:opacity-90'
                } disabled:opacity-50`}
              >
                {isSubmitting
                  ? isBranchScope
                    ? 'Removing…'
                    : 'Deleting…'
                  : isBranchScope
                  ? 'Remove'
                  : 'Delete'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}