import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExclamationTriangleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

export default function TrialToast({
  open,
  daysLeft,
  hoursLeft,
  onUpgrade,
  onCompare,
  offsetRight = 20,
}: {
  open: boolean;
  daysLeft: number;
  hoursLeft: number;
  onUpgrade: () => void;
  onCompare?: () => void;
  offsetRight?: number; // dynamic right offset so it shifts when AI panel opens
}) {
  // Persist collapsed state so the toast remembers user preference
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('trial-toast-collapsed');
      return raw === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('trial-toast-collapsed', collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);

  const timeLeftLabel = useMemo(() => {
    return daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h left` : `${hoursLeft}h left`;
  }, [daysLeft, hoursLeft]);

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
          initial={{ opacity: 0, y: 12, right: offsetRight }}
          animate={{ opacity: 1, y: 0, right: offsetRight }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: 'easeOut' }} // match AI panel timing
          layout="position"
          className="fixed z-[40] w-80 overflow-hidden rounded-xl border border-[#ececec] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
          role="status"
          aria-live="polite"
          style={{ bottom: 20 }}
        >
          {/* Header */}
          <div className="flex items-start gap-3 p-3">
            <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-full bg-amber-50 ring-1 ring-amber-200">
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    Trial ending soon
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    {timeLeftLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? 'Expand' : 'Collapse'}
                  className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#e5e5e5] text-slate-600 hover:bg-slate-50"
                >
                  <ChevronDownIcon
                    className={`h-4 w-4 transition-transform duration-200 ${
                      collapsed ? '-rotate-90' : 'rotate-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-px w-full bg-[#f0f0f0]"
              />
            )}
          </AnimatePresence>

          {/* Body (collapsible) */}
          <AnimatePresence initial={false} mode="sync">
            {!collapsed && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <div className="p-3 pt-2">
                  <p className="text-[12px] text-slate-600">
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
              </motion.div>
            )}
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}