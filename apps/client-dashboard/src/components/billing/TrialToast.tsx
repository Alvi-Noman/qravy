import { motion, AnimatePresence } from 'framer-motion';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function TrialToast({
  open,
  daysLeft,
  hoursLeft,
  // Keep props for compatibility; we handle navigation internally
  // onUpgrade,
  // onCompare,
}: {
  open: boolean;
  daysLeft: number;
  hoursLeft: number;
  onUpgrade: () => void;
  onCompare?: () => void;
}) {
  const handleAddBilling = () => {
    // Absolute URL (subscribe step)
    window.location.href = 'http://localhost:5173/settings/plan/select?step=subscribe';
  };

  const handleChangePlan = () => {
    // In-app route (select step)
    window.location.href = '/settings/plan/select?step=select';
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed bottom-5 right-5 z-[60] w-80 overflow-hidden rounded-xl border border-[#ececec] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3 p-3">
            <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-full bg-amber-50 ring-1 ring-amber-200">
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  Trial ending soon
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h left` : `${hoursLeft}h left`}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-slate-600">
                Add your billing info now to ensure uninterrupted service.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddBilling}
                  className="inline-flex items-center justify-center rounded-md bg-[#2e2e30] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
                >
                  Add Billing Info
                </button>
                <button
                  type="button"
                  onClick={handleChangePlan}
                  className="inline-flex items-center justify-center rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Change Plan
                </button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}