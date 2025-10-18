import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '../../context/ScopeContext';
import { fetchLocations, type Location } from '../../api/locations';
import { useAuthContext } from '../../context/AuthContext';
import { getCategories, type Category } from '../../api/categories';

type FormValues = { name: string };

type SubmitOptions = {
  channel?: 'dine-in' | 'online' | 'both';
  includeLocationIds?: string[];
  excludeLocationIds?: string[];
  locationId?: string;
};

// Subscribe to the per-branch channel lists so the dialog updates as soon as data arrives
function useChannelFlagsForCategory(categoryId: string | undefined, open: boolean) {
  const { token } = useAuthContext();
  const { activeLocationId } = useScope();
  const lidKey = activeLocationId || 'all';

  // only query when dialog is open, in a branch scope, and we have a category id
  const enabled = !!open && !!token && !!activeLocationId && !!categoryId;

  const dineInQ = useQuery<Category[]>({
    queryKey: ['categories', token, lidKey, 'dine-in'],
    enabled,
    queryFn: () =>
      getCategories(token as string, {
        locationId: activeLocationId as string,
        channel: 'dine-in',
      }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const onlineQ = useQuery<Category[]>({
    queryKey: ['categories', token, lidKey, 'online'],
    enabled,
    queryFn: () =>
      getCategories(token as string, {
        locationId: activeLocationId as string,
        channel: 'online',
      }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Return undefined until data is present so the caller can avoid seeding with wrong values
  const dineIn =
    enabled && dineInQ.data ? dineInQ.data.some((c) => c.id === categoryId) : undefined;
  const online =
    enabled && onlineQ.data ? onlineQ.data.some((c) => c.id === categoryId) : undefined;

  return { dineIn, online };
}

export default function CategoryFormDialog({
  open,
  title,
  initialName = '',
  existingNames = [],
  // Edit defaults coming from Categories page
  initialChannel, // 'both' | 'dine-in' | 'online'
  initialIncludedLocationIds,
  initialExcludedLocationIds,
  // When editing an existing category, pass its id so we can read overlays
  initialCategoryId,
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
  initialCategoryId?: string;
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

  // Read current per-branch channel presence (only meaningful when editing in a branch)
  const { dineIn, online } = useChannelFlagsForCategory(initialCategoryId, open);

  // Channel checkboxes (must NOT touch branches)
  const [chDineIn, setChDineIn] = useState(true);
  const [chOnline, setChOnline] = useState(true);

  // Locations (only needed on All locations view)
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    enabled: !activeLocationId,
    staleTime: 30000,
  });
  const allLocations = locationsQuery.data ?? [];

  // Branch selection state
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const [branchesTouched, setBranchesTouched] = useState(false);

  // Initialize channels & name per open (do not touch branches here)
  useEffect(() => {
    if (!open) return;

    reset({ name: initialName });

    // If we're in a specific location and editing an existing category, prefer overlay flags
    if (
      activeLocationId &&
      initialCategoryId &&
      typeof dineIn === 'boolean' &&
      typeof online === 'boolean'
    ) {
      setChDineIn(dineIn);
      setChOnline(online);
    } else {
      // Fall back to incoming initialChannel/scope rules
      if (initialChannel === 'dine-in') {
        setChDineIn(true);
        setChOnline(false);
      } else if (initialChannel === 'online') {
        setChDineIn(false);
        setChOnline(true);
      } else {
        // 'both' or undefined → follow scope channel, else both
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
    }

    // user hasn’t touched branches yet for this open
    setBranchesTouched(false);
  }, [
    open,
    initialName,
    initialChannel,
    scopeChannel,
    reset,
    activeLocationId,
    initialCategoryId,
    dineIn,
    online,
  ]);

  // Re-sync channel checkboxes if overlay-driven flags change while dialog is open
  useEffect(() => {
    if (!open) return;
    if (activeLocationId && initialCategoryId) {
      if (typeof dineIn === 'boolean') setChDineIn(dineIn);
      if (typeof online === 'boolean') setChOnline(online);
    }
  }, [open, activeLocationId, initialCategoryId, dineIn, online]);

  /**
   * Reseed branches whenever:
   *  - dialog is open
   *  - we’re in All locations (no activeLocationId)
   *  - locations are loaded
   *  - AND the incoming include/exclude (or locations) change
   *  - BUT only if the user has not manually changed the branch checkboxes (branchesTouched=false)
   *
   * In All-locations edit:
   * - For single-base-channel categories (initialChannel === 'dine-in' | 'online'),
   *   ignore includeLocationIds that originated from overlays on the *other* channel.
   *   Default to "all selected" unless there are explicit excludes.
   */
  const lastSeedSigRef = useRef<string>('');
  useEffect(() => {
    if (!open) return;
    if (activeLocationId) return; // single-location view: branch UI hidden
    if (!allLocations.length) return;
    if (branchesTouched) return; // don't override user edits

    const include = (initialIncludedLocationIds ?? []).filter(Boolean);
    const exclude = (initialExcludedLocationIds ?? []).filter(Boolean);

    // Build a signature of inputs; if unchanged, don’t reseed
    const sig = JSON.stringify({
      locs: allLocations.map((l) => l.id).sort(),
      inc: [...include].sort(),
      exc: [...exclude].sort(),
      ch: initialChannel ?? 'both',
    });
    if (sig === lastSeedSigRef.current) return;

    const allIds = allLocations.map((l) => l.id);
    const isSingleBaseChannel = initialChannel === 'dine-in' || initialChannel === 'online';

    if (exclude.length > 0) {
      const keep = allIds.filter((id) => !exclude.includes(id));
      setSelectedBranchIds(new Set(keep));
    } else if (include.length > 0) {
      // If the category is single-channel by *base* scope, do not let a one-off
      // include list (likely from the other channel) drive the seed selection.
      if (isSingleBaseChannel) {
        setSelectedBranchIds(new Set(allIds));
      } else {
        setSelectedBranchIds(new Set(include));
      }
    } else {
      // default: select all
      setSelectedBranchIds(new Set(allIds));
    }

    lastSeedSigRef.current = sig;
  }, [
    open,
    activeLocationId,
    allLocations,
    initialIncludedLocationIds,
    initialExcludedLocationIds,
    branchesTouched,
    initialChannel,
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

    // Channels (independent from branches)
    opts.channel = chDineIn && chOnline ? 'both' : chDineIn ? 'dine-in' : 'online';

    // Branch logic
    opts.locationId = activeLocationId ?? undefined;

    if (!activeLocationId && allLocations.length) {
      const allIds = allLocations.map((l) => l.id);
      const checked = Array.from(selectedBranchIds);
      const unchecked = allIds.filter((id) => !selectedBranchIds.has(id));

      const initiallyExcluded = new Set((initialExcludedLocationIds ?? []).filter(Boolean));
      const initiallyIncluded = new Set((initialIncludedLocationIds ?? []).filter(Boolean));

      if (unchecked.length === 0) {
        // If there was any prior restriction, send an explicit include-all to clear tombstones
        if (initiallyExcluded.size > 0 || initiallyIncluded.size > 0) {
          opts.includeLocationIds = allIds;
        }
      } else {
        const anyCheckedWasPreviouslyExcluded = checked.some((id) => initiallyExcluded.has(id));
        if (anyCheckedWasPreviouslyExcluded) {
          // re-include those checked ones (clears tombstones for them)
          opts.includeLocationIds = checked;
        } else {
          // exclude the unchecked ones
          opts.excludeLocationIds = unchecked;
        }
      }
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
              setBranchesTouched(true);
            }}
          />
          <span className="text-sm text-[#2e2e30]">{loc.name}</span>
        </label>
      );
    });
  }, [allLocations, selectedBranchIds]);

  const locationDisplay = useMemo(() => {
    if (!activeLocationId) return '';
    const loc = allLocations.find((l) => l.id === activeLocationId);
    return loc?.name || 'Current location';
  }, [activeLocationId, allLocations]);

  const singleChannel = chDineIn !== chOnline ? (chDineIn ? 'Dine-In' : 'Online') : null;
  const shouldShowBadge = !!activeLocationId;
  const badgeText = shouldShowBadge
    ? singleChannel
      ? `${locationDisplay} • ${singleChannel}`
      : locationDisplay
    : '';

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

            {advancedError ? (
              <div className="mt-2 text-sm text-red-600">{advancedError}</div>
            ) : null}

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
