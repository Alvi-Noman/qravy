import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '../../context/ScopeContext';
import { fetchLocations, type Location } from '../../api/locations';

type FormValues = { name: string };

type SubmitOptions = {
  channel?: 'dine-in' | 'online';
  includeLocationIds?: string[];
  excludeLocationIds?: string[];
  locationId?: string;
};

export default function CategoryFormDialog({
  open,
  title,
  initialName = '',
  existingNames = [],
  // NEW: edit-time “advanced” defaults coming from Categories page
  initialChannel, // 'both' | 'dine-in' | 'online'
  initialIncludedLocationIds,
  initialExcludedLocationIds,
  onClose,
  onSubmit,
  isSubmitting = false,
}: {
  open: boolean;
  title: string;
  initialName?: string;
  existingNames?: string[];
  initialChannel?: 'both' | 'dine-in' | 'online';
  initialIncludedLocationIds?: string[];
  initialExcludedLocationIds?: string[];
  onClose: () => void;
  onSubmit: (name: string, opts?: SubmitOptions) => void | Promise<void>;
  isSubmitting?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<FormValues>({
    defaultValues: { name: initialName },
    mode: 'onChange',
  });

  const { activeLocationId, channel: scopeChannel } = useScope();

  // Advanced controls
  // — Channels default:
  //    • on create: prefer scope channel if single, otherwise both
  //    • on edit: respect initialChannel from props
  const [chDineIn, setChDineIn] = useState(true);
  const [chOnline, setChOnline] = useState(true);

  // Locations (only needed on All locations view)
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    enabled: !activeLocationId, // only fetch when All locations
    staleTime: 30000,
  });
  const allLocations = locationsQuery.data ?? [];
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());

  // Re-initialize everything when dialog opens or defaults change
  useEffect(() => {
    if (!open) return;

    // Reset name field
    reset({ name: initialName });

    // ----- Channels -----
    if (initialChannel === 'dine-in') {
      setChDineIn(true);
      setChOnline(false);
    } else if (initialChannel === 'online') {
      setChDineIn(false);
      setChOnline(true);
    } else if (initialChannel === 'both' || initialChannel == null) {
      // Create or unspecified → base on scope
      if (scopeChannel === 'dine-in') {
        setChDineIn(true);
        setChOnline(false);
      } else if (scopeChannel === 'online') {
        setChDineIn(false);
        setChOnline(true);
      } else {
        setChDineIn(true);
        setChOnline(true);
      }
    }

    // Branches will be initialized in the effect below once locations load
    setSelectedBranchIds(new Set()); // temporarily clear to allow proper seeding
  }, [open, initialName, initialChannel, scopeChannel, reset]);

  // Initialize branch selection once locations are loaded (All locations only).
  // Precedence:
  //   1) initialIncludedLocationIds → exactly those checked
  //   2) initialExcludedLocationIds → all except those checked
  //   3) default → all checked
  useEffect(() => {
    if (activeLocationId) return; // no branches UI in branch scope
    if (!open) return;
    if (!allLocations.length) return;

    const include = (initialIncludedLocationIds ?? []).filter(Boolean);
    const exclude = (initialExcludedLocationIds ?? []).filter(Boolean);

    if (include.length > 0) {
      setSelectedBranchIds(new Set(include));
    } else if (exclude.length > 0) {
      const allIds = allLocations.map((l) => l.id);
      const keep = allIds.filter((id) => !exclude.includes(id));
      setSelectedBranchIds(new Set(keep));
    } else if (selectedBranchIds.size === 0) {
      // default: select all
      setSelectedBranchIds(new Set(allLocations.map((l) => l.id)));
    }
  }, [
    open,
    activeLocationId,
    allLocations,
    initialIncludedLocationIds,
    initialExcludedLocationIds,
    selectedBranchIds.size,
  ]);

  const validateUnique = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Name is required.';
    if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      return 'A category with this name already exists.';
    }
    return true;
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const busy = isSubmitting || rhfSubmitting;

  const submit = async (v: FormValues) => {
    // Validate advanced selections
    setAdvancedError(null);

    if (!chDineIn && !chOnline) {
      setAdvancedError('Select at least one channel (Dine-In or Online).');
      return;
    }

    if (!activeLocationId && allLocations.length && selectedBranchIds.size === 0) {
      setAdvancedError('Select at least one branch.');
      return;
    }

    const opts: SubmitOptions = {};

    // Channel: if exactly one checked, set that channel. If both, omit (defaults to both).
    if (chDineIn !== chOnline) {
      opts.channel = chDineIn ? 'dine-in' : 'online';
    }

    // Branches:
    // - If on a specific branch (sidebar), scope category to that locationId.
    // - If All locations, derive exclude list for unchecked branches.
    if (activeLocationId) {
      opts.locationId = activeLocationId;
    } else if (allLocations.length) {
      const allIds = allLocations.map((l) => l.id);
      const unchecked = allIds.filter((id) => !selectedBranchIds.has(id));
      if (unchecked.length > 0) {
        // Hide category in these branches
        opts.excludeLocationIds = unchecked;
      }
      // If you want to seed "only these branches" use includeLocationIds instead:
      // opts.includeLocationIds = Array.from(selectedBranchIds);
    }

    await onSubmit(v.name.trim(), opts);
  };

  const branchesList = useMemo(() => {
    return allLocations.map((loc) => {
      const checked = selectedBranchIds.has(loc.id);
      return (
        <label key={loc.id} className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              const next = new Set(selectedBranchIds);
              if (e.currentTarget.checked) next.add(loc.id);
              else next.delete(loc.id);
              setSelectedBranchIds(next);
            }}
          />
          <span className="text-sm text-[#2e2e30]">{loc.name}</span>
        </label>
      );
    });
  }, [allLocations, selectedBranchIds]);

  // Badge logic (header)
  const locationDisplay = useMemo(() => {
    if (!activeLocationId) return '';
    const loc = allLocations.find((l) => l.id === activeLocationId);
    return loc?.name || 'Current location';
  }, [activeLocationId, allLocations]);

  const singleChannel = chDineIn !== chOnline ? (chDineIn ? 'Dine-In' : 'Online') : null;
  const shouldShowBadge = !!activeLocationId; // only when a specific location is selected
  const badgeText = shouldShowBadge ? (singleChannel ? `${locationDisplay} • ${singleChannel}` : locationDisplay) : '';

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
          <motion.form
            onSubmit={handleSubmit(submit)}
            initial={{ scale: 0.98, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-lg border border-[#ececec] bg-white p-5 shadow-lg"
          >
            <div className="mb-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
                {shouldShowBadge && badgeText ? (
                  <span
                    className="inline-flex items-center gap-2 rounded-full border border-[#dbdbdb] bg-[#fcfcfc] px-2.5 py-1 text-xs text-[#2e2e30] max-w-[60%] truncate"
                    title={badgeText}
                    aria-label={`Scope: ${badgeText}`}
                  >
                    <span className="truncate">{badgeText}</span>
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-[#6b6b70]">Give it a clear, concise name.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[#5b5b5d]" htmlFor="category-name">
                Category name
              </label>
              <input
                id="category-name"
                {...register('name', { validate: validateUnique })}
                placeholder="e.g. Starters"
                autoFocus
                className="w-full rounded-md border border-[#cecece] bg-white px-3 py-2 text-[#2e2e30] focus:outline-none focus:ring-2 focus:ring-[#e0e0e5]"
              />
              {errors.name?.message ? (
                <div className="text-sm text-red-600">{errors.name.message}</div>
              ) : null}
            </div>

            {/* Advanced collapsible */}
            <div className="mt-4">
              <button
                type="button"
                className="text-sm font-medium text-[#2e2e30] underline-offset-2 hover:underline"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                Advanced {advancedOpen ? '▲' : '▼'}
              </button>

              {advancedOpen && (
                <div className="mt-3 space-y-4 rounded-md border border-[#e6e6e8] bg-white p-3">
                  {/* Channels */}
                  <div>
                    <div className="text-sm font-medium text-[#2e2e30] mb-1">Channels</div>
                    <div className="flex items-center gap-4">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={chDineIn}
                          onChange={(e) => setChDineIn(e.currentTarget.checked)}
                        />
                        <span className="text-sm text-[#2e2e30]">Dine-In</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={chOnline}
                          onChange={(e) => setChOnline(e.currentTarget.checked)}
                        />
                        <span className="text-sm text-[#2e2e30]">Online</span>
                      </label>
                    </div>
                  </div>

                  {/* Branches */}
                  {!activeLocationId ? (
                    <div>
                      <div className="text-sm font-medium text-[#2e2e30] mb-1">Branches</div>
                      {locationsQuery.isLoading ? (
                        <div className="text-sm text-[#6b6b70]">Loading branches…</div>
                      ) : allLocations.length ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                          {branchesList}
                        </div>
                      ) : (
                        <div className="text-sm text-[#6b6b70]">No branches found.</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-[#6b6b70]">
                      This category will be created only in the current location.
                    </div>
                  )}
                </div>
              )}
            </div>

            {advancedError ? <div className="mt-2 text-sm text-red-600">{advancedError}</div> : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-[#cecece] px-4 py-2 text-sm hover:bg-[#f5f5f5] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
