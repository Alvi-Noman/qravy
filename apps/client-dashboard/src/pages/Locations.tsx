import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Location } from '../api/locations';
import { useLocations } from '../components/locations/useLocations';
import LocationsToolbar, { type SortBy } from '../components/locations/LocationsToolbar';
import LocationsToolbarSkeleton from '../components/locations/LocationsToolbarSkeleton';
import LocationListSkeleton from '../components/locations/LocationListSkeleton';
import LocationFormDialog, { type LocationFormValues } from '../components/locations/LocationFormDialog';
import { MapPinIcon } from '@heroicons/react/24/outline';
import { getDefaultLocationId, setDefaultLocationId } from '../api/locations';
import DefaultLocationDialog from '../components/locations/DefaultLocationDialog';
import RemoveDefaultDialog from '../components/locations/RemoveDefaultDialog';
import api from '../api/auth';

const LocationList = lazy(() => import('../components/locations/LocationList'));
const DeleteLocationDialog = lazy(
  () => import('../components/locations/DeleteLocationDialog')
);

const HIGHLIGHT_HOLD_MS = 2500;
const SHRINK_DISTANCE = 80;
const DEFAULT_LOCATION_KEY = 'defaultLocationId';

function getScrollContainer(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    const scrollable =
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight;
    if (scrollable) return node;
    node = node.parentElement;
  }
  return window;
}
function getScrollTop(scroller: HTMLElement | Window): number {
  if (scroller === window) {
    return (
      window.scrollY ||
      document.documentElement.scrollTop ||
      (document.body ? document.body.scrollTop : 0)
    );
  }
  return (scroller as HTMLElement).scrollTop;
}
function waitForScrollIdle(
  scroller: HTMLElement | Window,
  idleMs = 140,
  maxWaitMs = 2500
): Promise<void> {
  return new Promise((resolve) => {
    let lastTop = getScrollTop(scroller);
    let lastChange = performance.now();
    const deadline = performance.now() + maxWaitMs;
    const tick = () => {
      const now = performance.now();
      const top = getScrollTop(scroller);
      if (top !== lastTop) {
        lastTop = top;
        lastChange = now;
      }
      if (now - lastChange >= idleMs || now >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export default function LocationsPage() {
  const {
    locationsQuery,
    locations,
    createMut,
    updateMut,
    deleteMut,
  } = useLocations();

  const [searchParams, setSearchParams] = useSearchParams();
  const routeWantsNew = searchParams.get('new') === 'location';

  // Cross-tab refresh
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'locations:updated') locationsQuery.refetch();
      if (e.key === DEFAULT_LOCATION_KEY) {
        setDefaultLocationIdState(e.newValue || null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [locationsQuery]);

  // UI state
  const [q, setQ] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('name-asc');

  const [openForm, setOpenForm] = useState<boolean>(routeWantsNew);
  const [editing, setEditing] = useState<Location | null>(null);

  const [openDelete, setOpenDelete] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  // Auto-open new
  useEffect(() => {
    if (routeWantsNew) {
      setEditing(null);
      setOpenForm(true);
    }
  }, [routeWantsNew]);

  // Freeze + highlight
  const [frozenLocations, setFrozenLocations] = useState<Location[] | null>(null);
  const sourceLocations: Location[] = frozenLocations ?? locations;

  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [queuedHighlightId, setQueuedHighlightId] = useState<string | null>(null);

  // Shrink header
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shrink, setShrink] = useState<number>(0);

  useLayoutEffect(() => {
    const scroller = contentRef.current;
    if (!scroller) return;
    let raf = 0;
    let last = -1;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const onScroll = () => {
      const t = clamp01(scroller.scrollTop / SHRINK_DISTANCE);
      if (t === last) return;
      last = t;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setShrink(t));
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Default (pinned) location state
  const [defaultLocationId, setDefaultLocationIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DEFAULT_LOCATION_KEY) || null;
    } catch {
      return null;
    }
  });
  const [defaultFetched, setDefaultFetched] = useState(false);

  // Set default dialog state
  const [setOpen, setSetOpen] = useState(false);
  const [setName, setSetName] = useState('');
  const [setId, setSetId] = useState<string | null>(null);
  const [setSaving, setSetSaving] = useState(false);

  // Remove default dialog state
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeName, setRemoveName] = useState('');
  const [removeSaving, setRemoveSaving] = useState(false);

  // Fetch default location from backend on mount (no fallback to earliest)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const defId = await getDefaultLocationId();
        if (!mounted) return;
        if (defId) {
          setDefaultLocationIdState(defId);
          try {
            localStorage.setItem(DEFAULT_LOCATION_KEY, defId);
          } catch {}
        }
      } catch {
        // ignore; keep local cached default (can be null)
      } finally {
        setDefaultFetched(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Toggle handler for pin button
  const handleToggleDefault = (loc: Location) => {
    if (!defaultLocationId) {
      // No default yet -> propose to set this as default
      setSetId(loc.id);
      setSetName(loc.name);
      setSetOpen(true);
      return;
    }
    if (String(defaultLocationId) === String(loc.id)) {
      // Clicking the pinned one -> remove default
      setRemoveName(loc.name);
      setRemoveOpen(true);
      return;
    }
    // Switching from one default to another -> confirm set
    setSetId(loc.id);
    setSetName(loc.name);
    setSetOpen(true);
  };

  // Confirm set default
  const confirmSetDefault = async () => {
    if (!setId) return;
    setSetSaving(true);
    try {
      await setDefaultLocationId(setId);
      setDefaultLocationIdState(setId);
      try {
        localStorage.setItem(DEFAULT_LOCATION_KEY, setId);
        localStorage.setItem('locations:activeId', setId);
        localStorage.setItem('locations:updated', Date.now().toString());
      } catch {}
      setSetOpen(false);
      window.location.replace('/dashboard');
    } catch {
      // leave dialog open
    } finally {
      setSetSaving(false);
    }
  };

  // Confirm remove default
  const confirmRemoveDefault = async () => {
    setRemoveSaving(true);
    try {
      await api.delete('/api/v1/locations/default');
      setDefaultLocationIdState(null);
      try {
        localStorage.removeItem(DEFAULT_LOCATION_KEY);
        localStorage.setItem('locations:activeId', ''); // All locations
        localStorage.setItem('locations:updated', Date.now().toString());
      } catch {}
      setRemoveOpen(false);
    } catch {
      // keep dialog open
    } finally {
      setRemoveSaving(false);
    }
  };

  // Derived view
  const viewLocations: Location[] = useMemo(() => {
    const base: Location[] = Array.isArray(sourceLocations) ? sourceLocations : [];
    let list: Location[] = base.slice();

    const qnorm = q.trim().toLowerCase();
    if (qnorm) {
      list = list.filter((l: Location) => {
        const name = l.name?.toLowerCase() ?? '';
        const address = l.address?.toLowerCase() ?? '';
        const zip = l.zip?.toLowerCase() ?? '';
        const country = l.country?.toLowerCase() ?? '';
        return (
          name.includes(qnorm) ||
          address.includes(qnorm) ||
          zip.includes(qnorm) ||
          country.includes(qnorm)
        );
      });
    }
    if (sortBy === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created-desc')
      list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    return list;
  }, [sourceLocations, q, sortBy]);

  // Scroll-to + highlight
  useEffect(() => {
    if (!pendingHighlightId) return;
    const exists = viewLocations.some((l: Location) => l.id === pendingHighlightId);
    if (!exists) return;
    const node = document.querySelector(
      `[data-item-id="${pendingHighlightId}"]`
    ) as HTMLElement | null;
    if (!node) return;
    const scroller = contentRef.current || getScrollContainer(node);
    const before = getScrollTop(scroller);
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const raf = requestAnimationFrame(async () => {
      const after = getScrollTop(scroller);
      const didScroll = after !== before;
      if (didScroll) await waitForScrollIdle(scroller, 140, 2500);
      setHighlightId(pendingHighlightId);
      setPendingHighlightId(null);
      window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingHighlightId, viewLocations]);

  // Freeze list during edit, restore after
  useEffect(() => {
    if (openForm && editing && !frozenLocations) {
      setFrozenLocations(locations);
    }
  }, [openForm, editing, frozenLocations, locations]);

  useEffect(() => {
    if (!openForm && (frozenLocations || queuedHighlightId)) {
      locationsQuery
        .refetch()
        .catch(() => {})
        .finally(() => {
          if (queuedHighlightId) {
            setHighlightId(queuedHighlightId);
            setQueuedHighlightId(null);
            window.setTimeout(() => setHighlightId(null), HIGHLIGHT_HOLD_MS);
          }
          setFrozenLocations(null);
        });
    }
  }, [openForm, frozenLocations, queuedHighlightId, locationsQuery]);

  const loading = locationsQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto p-0 text-sm text-[#2e2e30]"
      >
        {/* Header */}
        <div
          className="sticky top-0 z-20 flex items-center justify-between border-b border-[#ececec] px-6"
          style={{
            paddingTop: `${16 - 8 * shrink}px`,
            paddingBottom: `${16 - 8 * shrink}px`,
            backgroundColor: `rgba(252, 252, 252, ${1 - 0.75 * shrink})`,
            WebkitBackdropFilter: 'blur(5px)',
            backdropFilter: 'blur(5px)',
            transition: 'padding 160ms ease, background-color 160ms ease',
          }}
        >
          <h2
            className="text-lg font-semibold text-[#2e2e30]"
            style={{
              transform: `translateY(${2 * shrink}px) scale(${1 - 0.06 * shrink})`,
              transformOrigin: 'left center',
              transition: 'transform 160ms ease',
            }}
          >
            Locations
          </h2>
          <div
            className="flex items-center gap-2"
            style={{
              transform: `scale(${1 - 0.05 * shrink})`,
              transformOrigin: 'right center',
              transition: 'transform 160ms ease',
            }}
          >
            <Link
              to="/locations/manage"
              className="rounded-md border border-[#cecece] px-4 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
            >
              Manage Locations
            </Link>
            <button
              className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white hover:opacity-90"
              onClick={() => {
                setEditing(null);
                const sp = new URLSearchParams(searchParams);
                sp.set('new', 'location');
                setSearchParams(sp, { replace: false });
                setOpenForm(true);
              }}
            >
              Add Location
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pt-4">
          {loading ? (
            <>
              <LocationsToolbarSkeleton />
              <div className="mt-4">
                <LocationListSkeleton rows={6} />
              </div>
            </>
          ) : locationsQuery.isError ? (
            <div className="text-red-600">Failed to load locations.</div>
          ) : (
            <>
              <LocationsToolbar
                q={q}
                setQ={setQ}
                sortBy={sortBy}
                setSortBy={setSortBy}
              />
              <div className="mt-4 space-y-4">
                {!viewLocations.length ? (
                  <div className="flex h-[60vh] flex-col items-center justify-center p-8 text-center">
                    <MapPinIcon className="mb-3 h-12 w-12 text-slate-400" />
                    <h2 className="text-xl font-semibold text-[#2e2e30]">
                      No Locations Yet
                    </h2>
                    <p className="mt-2 mb-6 max-w-md text-sm text-[#6b6b70]">
                      Add your stores, branches, or pickup points. Once added,
                      they’ll appear here.
                    </p>
                    <button
                      onClick={() => {
                        const sp = new URLSearchParams(searchParams);
                        setSearchParams(sp, { replace: false });
                        setOpenForm(true);
                      }}
                      className="rounded-md bg-[#2e2e30] px-5 py-2 text-white hover:opacity-90"
                    >
                      Add Location
                    </button>
                  </div>
                ) : (
                  <Suspense fallback={<LocationListSkeleton rows={6} />}>
                    <LocationList
                      locations={viewLocations}
                      highlightId={highlightId}
                      defaultLocationId={defaultLocationId}
                      onToggleDefault={handleToggleDefault}
                      onEdit={(l: Location) => {
                        setEditing(l);
                        setOpenForm(true);
                      }}
                      onDelete={(l: Location) => {
                        setDeleteTarget(l);
                        setOpenDelete(true);
                      }}
                    />
                  </Suspense>
                )}
              </div>

              {/* Form (not lazy, opens immediately) */}
              <LocationFormDialog
                open={openForm}
                title={editing ? 'Edit Location' : 'Add Location'}
                initialValues={{
                  name: editing?.name || '',
                  address: editing?.address || '',
                  zip: editing?.zip || '',
                  country: editing?.country || '',
                }}
                existingNames={
                  editing
                    ? locations
                        .map((l: Location) => l.name)
                        .filter(
                          (n: string) => n.toLowerCase() !== editing.name.toLowerCase()
                        )
                    : locations.map((l: Location) => l.name)
                }
                isSubmitting={createMut.isPending || updateMut.isPending}
                onClose={() => {
                  setOpenForm(false);
                  const sp = new URLSearchParams(searchParams);
                  sp.delete('new');
                  setSearchParams(sp, { replace: true });
                }}
                onSubmit={async (values: LocationFormValues) => {
                  if (editing) {
                    const updated = await updateMut.mutateAsync({
                      id: editing.id,
                      ...values,
                    });
                    setOpenForm(false);
                    const sp = new URLSearchParams(searchParams);
                    sp.delete('new');
                    setSearchParams(sp, { replace: true });
                    setQueuedHighlightId(updated.id);
                  } else {
                    const created = await createMut.mutateAsync(values);
                    setOpenForm(false);
                    const sp = new URLSearchParams(searchParams);
                    sp.delete('new');
                    setSearchParams(sp, { replace: true });
                    setPendingHighlightId(created.id);
                    // Pins are optional; do not auto-pin the first location
                  }
                }}
              />

              {/* Delete dialog */}
              <Suspense fallback={null}>
                <DeleteLocationDialog
                  open={openDelete}
                  location={deleteTarget}
                  isSubmitting={deleteMut.isPending}
                  onClose={() => setOpenDelete(false)}
                  onConfirm={() => {
                    if (!deleteTarget) return;
                    const deletingId = deleteTarget.id;
                    deleteMut.mutate(
                      { id: deletingId },
                      {
                        onSuccess: () => {
                          setOpenDelete(false);
                          if (defaultLocationId === deletingId) {
                            setDefaultLocationIdState(null);
                            try {
                              localStorage.removeItem(DEFAULT_LOCATION_KEY);
                              localStorage.setItem('locations:activeId', ''); // All locations after deletion
                              localStorage.setItem('locations:updated', Date.now().toString());
                            } catch {}
                          }
                        },
                      }
                    );
                  }}
                />
              </Suspense>
            </>
          )}
        </div>
      </div>

      {/* Set default dialog */}
      <DefaultLocationDialog
        open={setOpen}
        locationName={setName}
        isSubmitting={setSaving}
        onCancel={() => setSetOpen(false)}
        onConfirm={confirmSetDefault}
      />

      {/* Remove default dialog */}
      <RemoveDefaultDialog
        open={removeOpen}
        locationName={removeName}
        isSubmitting={removeSaving}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={confirmRemoveDefault}
      />
    </div>
  );
}