import { useState, useEffect } from 'react';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { useAuthContext } from '../../context/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { toastSuccess, toastError } from '../../components/Toaster';
import {
  BuildingOffice2Icon,
  EnvelopeIcon,
  GlobeAltIcon,
  SparklesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { fetchLocations, updateLocation, type Location } from '../../api/locations';

const SparkleIcon = () => (
  <motion.div
    initial={{ scale: 0, rotate: -30 }}
    animate={{ scale: [0, 1.2, 1], rotate: [0, 15, 0] }}
    transition={{ duration: 0.6, ease: 'easeOut' }}
    className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 border border-slate-100 text-[#2e2e30] mb-4 relative"
  >
    <SparklesIcon className="h-8 w-8 text-[#2e2e30]" />
    <motion.div
      animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.7, 0.3] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute inset-0 rounded-full border border-slate-300/60"
    />
  </motion.div>
);

export default function SettingsPreferences(): JSX.Element {
  const { token } = useAuthContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();

  const [locationMode, setLocationMode] = useState<'single' | 'multiple'>('single');
  const [onlineSalesEnabled, setOnlineSalesEnabled] = useState<boolean>(true);
  const [dineInEnabled, setDineInEnabled] = useState<boolean>(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal display states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCelebrateModal, setShowCelebrateModal] = useState(false);
  const [showDisableConfirmModal, setShowDisableConfirmModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);

  // Reactivation flow states
  const [existingLocations, setExistingLocations] = useState<Location[]>([]);
  const [selectedReactivateIds, setSelectedReactivateIds] = useState<Set<string>>(new Set());
  const [reactivateStep, setReactivateStep] = useState<'select' | 'confirm' | 'success'>('select');
  const [reactivateSaving, setReactivateSaving] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Plan pricing constants
  const planId = tenant?.planInfo?.planId || 'p1_m';
  const isPro = planId.toLowerCase().includes('p2');
  const planName = isPro ? 'Pro' : 'Starter';
  const planPrice = isPro ? 99 : 29;

  useEffect(() => {
    if (tenant) {
      setLocationMode(tenant.restaurantInfo?.locationMode || 'single');
      setOnlineSalesEnabled(tenant.restaurantInfo?.onlineSalesEnabled ?? true);
      setDineInEnabled(tenant.restaurantInfo?.dineInEnabled ?? true);
    }
  }, [tenant]);

  // Handle Confetti firing on successful multiple location activation
  useEffect(() => {
    if (showCelebrateModal) {
      // First burst
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
      // Second burst
      const t1 = setTimeout(() => {
        confetti({
          particleCount: 50,
          spread: 80,
          origin: { y: 0.55, x: 0.3 }
        });
      }, 250);
      // Third burst
      const t2 = setTimeout(() => {
        confetti({
          particleCount: 50,
          spread: 80,
          origin: { y: 0.55, x: 0.7 }
        });
      }, 400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [showCelebrateModal]);

  const handleDiscard = () => {
    if (tenant) {
      setLocationMode(tenant.restaurantInfo?.locationMode || 'single');
      setOnlineSalesEnabled(tenant.restaurantInfo?.onlineSalesEnabled ?? true);
      setDineInEnabled(tenant.restaurantInfo?.dineInEnabled ?? true);
    }
    setDirty(false);
  };

  const handleSave = async () => {
    if (!token) return;
    if (!dineInEnabled && !onlineSalesEnabled) {
      toastError('At least one sales channel must be enabled');
      return;
    }
    const oldMode = tenant?.restaurantInfo?.locationMode || 'single';
    setSaving(true);
    try {
      await updateTenant(
        {
          restaurantInfo: {
            ...tenant?.restaurantInfo,
            locationMode,
            onlineSalesEnabled,
            dineInEnabled,
          },
        },
        token
      );
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      setDirty(false);
      toastSuccess('Operations settings saved successfully');

      // Trigger celebrate modal if we upgraded from single to multiple locations
      if (oldMode === 'single' && locationMode === 'multiple') {
        setShowCelebrateModal(true);
      }
    } catch (err) {
      toastError('Failed to save operations settings');
      // eslint-disable-next-line no-console
      console.error('Failed to save operations settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOn = async () => {
    setLoadingLocations(true);
    try {
      const locs = await fetchLocations();
      if (locs.length > 1) {
        // Sort locations: currently active location first, then oldest by createdAt
        const sorted = [...locs].sort((a, b) => {
          if (!a.disabled && b.disabled) return -1;
          if (a.disabled && !b.disabled) return 1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        setExistingLocations(sorted);

        const primary = sorted.find((l) => !l.disabled) || sorted[0];
        const initialSelected = new Set<string>();
        if (primary) initialSelected.add(primary.id);
        sorted.forEach((l) => {
          if (!l.disabled) initialSelected.add(l.id);
        });

        setSelectedReactivateIds(initialSelected);
        setReactivateStep('select');
        setShowReactivateModal(true);
      } else {
        setShowConfirmModal(true);
      }
    } catch (err) {
      console.error('Failed to fetch existing locations:', err);
      setShowConfirmModal(true);
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleReactivateSubmit = async () => {
    if (!token) return;
    setReactivateSaving(true);
    try {
      // 1. Update disabled status for each location
      await Promise.all(
        existingLocations.map((loc) => {
          const shouldBeEnabled = selectedReactivateIds.has(loc.id);
          if (loc.disabled !== !shouldBeEnabled) {
            return updateLocation(loc.id, {
              name: loc.name,
              address: loc.address,
              zip: loc.zip,
              country: loc.country,
              disabled: !shouldBeEnabled,
            });
          }
          return Promise.resolve();
        })
      );

      // 2. Enable multiple locations in tenant (saves immediately)
      await updateTenant(
        {
          restaurantInfo: {
            ...tenant?.restaurantInfo,
            locationMode: 'multiple',
          },
        },
        token
      );

      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      await queryClient.invalidateQueries({ queryKey: ['locations', token] });

      setLocationMode('multiple');
      setDirty(false);

      setReactivateStep('success');
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (err) {
      toastError('Failed to reactivate locations');
      console.error(err);
    } finally {
      setReactivateSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2e2e30] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 pb-6">
      {/* Title */}
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">Operations</h2>
      </div>

      {/* Preferences Cards */}
      <div className="space-y-4">
        {/* Locations Settings Card */}
        <div className="rounded-xl border border-[#ececec] bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[#ececec] bg-[#fafafa]">
            <h2 className="text-[14px] font-semibold text-slate-900">Locations & outlets</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Configure how physical dining or pickup spaces are managed in your account.
            </p>
          </div>
          <div className="p-5">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1">
                <label className="text-[14px] font-medium text-slate-900 block">
                  Enable Multiple Locations
                </label>
                <p className="text-[12px] text-slate-500 max-w-xl leading-relaxed">
                  Activate multiple locations to support separate menus, table layouts, and order management queues for different outlets, franchises, or branches. When turned off, the system runs in simplified single-location mode.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingLocations}
                onClick={() => {
                  if (locationMode === 'single') {
                    handleToggleOn();
                  } else {
                    setShowDisableConfirmModal(true);
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2e2e30] focus:ring-offset-2 ${
                  locationMode === 'multiple' ? 'bg-[#2e2e30]' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    locationMode === 'multiple' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Sales Channels Card */}
        <div className="rounded-xl border border-[#ececec] bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[#ececec] bg-[#fafafa]">
            <h2 className="text-[14px] font-semibold text-slate-900">Sales channels</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Control the active ordering channels available to your customers.
            </p>
          </div>
          <div className="p-5 space-y-5">
            {/* Dine-in Option */}
            <div className="flex items-start justify-between gap-6 pb-5 border-b border-slate-100">
              <div className="space-y-1">
                <label className="text-[14px] font-medium text-slate-900 block">
                  Enable Dine-in ordering (QR code at table)
                </label>
                <p className="text-[12px] text-slate-500 max-w-xl leading-relaxed">
                  Allow customers to scan a QR code at their table to view your menu, customize dishes, and submit orders directly to your kitchen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (dineInEnabled && !onlineSalesEnabled) {
                    toastError('At least one sales channel must be enabled');
                    return;
                  }
                  setDineInEnabled(!dineInEnabled);
                  setDirty(true);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2e2e30] focus:ring-offset-2 ${
                  dineInEnabled ? 'bg-[#2e2e30]' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    dineInEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Online Sales Option */}
            <div className="flex items-start justify-between gap-6 pt-2">
              <div className="space-y-1">
                <label className="text-[14px] font-medium text-slate-900 block">
                  Enable Online Sales (Ordering Storefront)
                </label>
                <p className="text-[12px] text-slate-500 max-w-xl leading-relaxed">
                  Allow customers to browse menus, customize dishes, place orders, and pay online. Disabling online sales hides the storefront and suspends all incoming digital checkout operations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onlineSalesEnabled && !dineInEnabled) {
                    toastError('At least one sales channel must be enabled');
                    return;
                  }
                  setOnlineSalesEnabled(!onlineSalesEnabled);
                  setDirty(true);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2e2e30] focus:ring-offset-2 ${
                  onlineSalesEnabled ? 'bg-[#2e2e30]' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    onlineSalesEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Save/Discard Sticky Bar */}
      {dirty && (
        <div className="sticky bottom-4 z-10 mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur flex items-center justify-between">
          <span className="text-sm text-slate-800 font-medium">
            {saving ? 'Saving changes…' : 'Unsaved operations'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm hover:bg-[#f6f6f6] font-medium text-slate-700 transition"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white hover:opacity-90 font-medium transition"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Confirm Unlock Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
            />

            {/* Modal Card */}
            <motion.aside
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-md bg-[#f5f5f5] border border-[#dbdbdb] rounded-xl shadow-2xl flex flex-col overflow-hidden"
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] bg-[#fcfcfc]">
                <h3 className="text-lg font-semibold text-[#2e2e30]">Unlock Multiple Locations?</h3>
                <button
                  className="text-[#6b7280] hover:text-[#374151]"
                  onClick={() => setShowConfirmModal(false)}
                  aria-label="Close"
                  type="button"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="p-5 bg-[#fcfcfc] space-y-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  Ready to expand your restaurant footprint? Activating Multiple Locations enables custom branch menus, localized roles, and individual table structures.
                </p>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-[12px] text-slate-600 leading-normal">
                  ℹ️ <strong>Billing details:</strong> Adding locations updates your monthly subscription prorated per branch based on your plan rate (Starter is $29/mo, Pro is $99/mo per branch). Feel free to scale up or down as your business grows!
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-[#dbdbdb] bg-[#fcfcfc] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827]"
                >
                  Maybe later
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocationMode('multiple');
                    setDirty(true);
                    setShowConfirmModal(false);
                  }}
                  className="px-4 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-medium"
                >
                  Yes, unlock this feature
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Celebrate Unlock Modal */}
      <AnimatePresence>
        {showCelebrateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCelebrateModal(false)}
            />

            {/* Modal Card */}
            <motion.aside
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-xl bg-[#f5f5f5] border border-[#dbdbdb] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
              role="dialog"
              aria-modal="true"
            >
              {/* Close button at top right */}
              <button
                className="absolute top-4 right-4 text-[#6b7280] hover:text-[#374151] z-20"
                onClick={() => setShowCelebrateModal(false)}
                aria-label="Close"
                type="button"
              >
                ✕
              </button>

              {/* Celebration Header Graphic */}
              <div className="bg-[#fcfcfc] pt-8 pb-4 text-center">
                <SparkleIcon />
                <h3 className="text-xl font-bold text-slate-800 px-4">Multi-Location Mode Unlocked</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                  Your platform is now optimized to support growth. Manage all outlets and teams under a unified operations hub.
                </p>
              </div>

              {/* Feature Highlights Grid */}
              <div className="p-6 bg-[#fcfcfc] border-t border-b border-[#dbdbdb] max-h-[45vh] overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="flex gap-3 text-left">
                    <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-[#2e2e30]">
                      <GlobeAltIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-slate-800">Shared Menu Architecture</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                        Maintain one master menu library, while overriding visibility and availability at specific branches.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 text-left">
                    <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-[#2e2e30]">
                      <EnvelopeIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-slate-800">Unified Staff Login</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                        Manage all permissions from a single portal. Staff log in with one email across all location assignments.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 text-left">
                    <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-[#2e2e30]">
                      <BuildingOffice2Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-slate-800">Centralized Platform</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                        Coordinate orders, menus, table configurations, and taxes centrally for all branches from one screen.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 text-left">
                    <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-[#2e2e30]">
                      <SparklesIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-slate-800">Transparent Billing</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                        Billing scales dynamically with your size. Prorated active branch fees are calculated automatically.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="px-5 py-4 bg-[#fcfcfc] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCelebrateModal(false)}
                  className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827]"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCelebrateModal(false);
                    navigate('/locations?new=location');
                  }}
                  className="px-5 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-semibold flex items-center gap-1.5"
                >
                  Start Adding Locations
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Disable Modal */}
      <AnimatePresence>
        {showDisableConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDisableConfirmModal(false)}
            />

            {/* Modal Card */}
            <motion.aside
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-md bg-[#f5f5f5] border border-[#dbdbdb] rounded-xl shadow-2xl flex flex-col overflow-hidden"
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] bg-[#fcfcfc]">
                <h3 className="text-lg font-semibold text-[#2e2e30]">Disable Multiple Locations?</h3>
                <button
                  className="text-[#6b7280] hover:text-[#374151]"
                  onClick={() => setShowDisableConfirmModal(false)}
                  aria-label="Close"
                  type="button"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="p-5 bg-[#fcfcfc] space-y-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  Toggling multiple locations off will limit your workspace to a single primary branch. We will stop charging for any additional locations starting from your next billing date.
                </p>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-[12px] text-slate-600 leading-normal">
                  ℹ️ <strong>Billing details:</strong> Your account will then only be billed for a single location at <strong>${planPrice}.00/mo</strong> based on your current <strong>{planName}</strong> plan.
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-[#dbdbdb] bg-[#fcfcfc] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisableConfirmModal(false)}
                  className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827]"
                >
                  Maybe later
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocationMode('single');
                    setDirty(true);
                    setShowDisableConfirmModal(false);
                  }}
                  className="px-4 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-medium"
                >
                  Yes, disable this feature
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Reactivate Branches Modal */}
      <AnimatePresence>
        {showReactivateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (reactivateSaving) return;
                setShowReactivateModal(false);
              }}
            />

            {/* Modal Card */}
            <motion.aside
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-lg bg-[#f5f5f5] border border-[#dbdbdb] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
              role="dialog"
              aria-modal="true"
            >
              {/* Close Button */}
              {reactivateStep !== 'success' && (
                <button
                  className="absolute top-4 right-4 text-[#6b7280] hover:text-[#374151] z-20"
                  onClick={() => setShowReactivateModal(false)}
                  aria-label="Close"
                  disabled={reactivateSaving}
                  type="button"
                >
                  ✕
                </button>
              )}

              {reactivateStep === 'select' && (
                <>
                  {/* Step 1: Select Outlets */}
                  <div className="bg-[#fcfcfc] px-6 pt-6 pb-4 border-b border-[#dbdbdb]">
                    <h3 className="text-lg font-bold text-slate-800">Reactivate Branches</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Choose which branches you would like to reactivate. It will be billed as per branches added.
                    </p>
                  </div>

                  <div className="p-6 bg-[#fcfcfc] max-h-[300px] overflow-y-auto space-y-3">
                    {existingLocations.map((loc, idx) => {
                      const isPrimary = idx === 0;
                      const isChecked = selectedReactivateIds.has(loc.id);
                      return (
                        <label
                          key={loc.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                            isPrimary
                              ? 'border-[#2e2e30] bg-[#fafafa]/50 opacity-90 cursor-not-allowed'
                              : isChecked
                              ? 'border-[#2e2e30] bg-[#fafafa] shadow-sm'
                              : 'border-slate-200 bg-white hover:border-[#2e2e30]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isPrimary}
                            onChange={() => {
                              if (isPrimary) return;
                              const next = new Set(selectedReactivateIds);
                              if (isChecked) {
                                next.delete(loc.id);
                              } else {
                                next.add(loc.id);
                              }
                              setSelectedReactivateIds(next);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-[#2e2e30] focus:ring-[#2e2e30] disabled:opacity-50"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-slate-800 block truncate">
                                {loc.name}
                              </span>
                              {isPrimary && (
                                <span className="inline-flex items-center rounded-md bg-[#2e2e30]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#2e2e30]">
                                  Main Branch
                                </span>
                              )}
                            </div>
                            {loc.address && (
                              <span className="text-[11px] text-slate-500 block truncate">
                                {loc.address}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="px-6 py-4 border-t border-[#dbdbdb] bg-[#fcfcfc] flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowReactivateModal(false)}
                      className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={selectedReactivateIds.size === 0}
                      onClick={() => setReactivateStep('confirm')}
                      className="px-5 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-medium disabled:opacity-50"
                    >
                      Next Step
                    </button>
                  </div>
                </>
              )}

              {reactivateStep === 'confirm' && (
                <>
                  {/* Step 2: Confirm Pricing */}
                  <div className="bg-[#fcfcfc] px-6 pt-6 pb-4 border-b border-[#dbdbdb]">
                    <h3 className="text-lg font-bold text-slate-800">Confirm Subscription</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Please review the pricing adjustment before reactivating.
                    </p>
                  </div>

                  <div className="p-6 bg-[#fcfcfc] space-y-4">
                    <div className="text-center py-4 bg-slate-50/50 rounded-xl border border-slate-100">
                      <p className="text-xs text-slate-500">Subscription Total</p>
                      <h4 className="text-2xl font-bold text-slate-900 mt-1">
                        Activate for ${selectedReactivateIds.size * planPrice}.00 per month?
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-1">
                        ({selectedReactivateIds.size} branches at ${planPrice}.00/mo per branch)
                      </p>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-[12px] text-slate-600 leading-normal">
                      ℹ️ <strong>Billing details:</strong> Reactivating will charge a prorated fee based on your {planName} plan (${planPrice}.00/mo per branch) to your card ending in •••• {tenant?.payment?.last4 || '4242'} immediately.
                    </div>
                  </div>

                  <div className="px-6 py-4 border-t border-[#dbdbdb] bg-[#fcfcfc] flex justify-end gap-3">
                    <button
                      type="button"
                      disabled={reactivateSaving}
                      onClick={() => setReactivateStep('select')}
                      className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827]"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={reactivateSaving}
                      onClick={handleReactivateSubmit}
                      className="px-5 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-medium flex items-center gap-1.5"
                    >
                      {reactivateSaving ? 'Activating...' : 'Confirm & Activate'}
                    </button>
                  </div>
                </>
              )}

              {reactivateStep === 'success' && (
                <>
                  {/* Step 3: Success Screen */}
                  <div className="p-8 bg-[#fcfcfc] text-center space-y-5">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 280, damping: 20 }}
                      className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 border border-slate-100 text-[#2e2e30]"
                    >
                      <CheckCircleIcon className="h-10 w-10 text-[#2e2e30]" />
                    </motion.div>

                    <div>
                      <h3 className="text-xl font-bold text-slate-800">Outlets Successfully Reactivated!</h3>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                        Congratulations! Your branches are now active. You can manage their individual menus, staff roles, and dine-in settings.
                      </p>
                    </div>

                    <div className="pt-2 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setShowReactivateModal(false);
                          navigate('/locations');
                        }}
                        className="px-6 py-2.5 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-semibold flex items-center gap-1.5"
                      >
                        Go to Locations
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
