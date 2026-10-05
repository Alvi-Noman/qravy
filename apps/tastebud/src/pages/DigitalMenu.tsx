// apps/tastebud/src/pages/DigitalMenu.tsx
import React from 'react';
import {
  useLocation,
  useParams,
  useSearchParams,
  Link,
  Navigate,
} from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Fuzzysort from 'fuzzysort';
import type { v1 } from '../../../../packages/shared/src/types';
import { listMenu, listCategories, getTenant, getHours, type Channel } from '../api/storefront';
import ProductCard from '../components/ProductCard';
import CategoryList from '../components/CategoryList';
import SearchBar from '../components/SearchBar';
import RestaurantSkeleton from '../components/RestaurantSkeleton';
import { FulfillmentToggle } from '../components/OnlineOrderDetails';
import { useFulfillment, useOrderChannel } from '../utils/order-mode';
import LangSwitch from '../components/LangSwitch';
import CartFab from '../components/ai-waiter/CartFab';
import { withTable } from '../utils/table';
import { storeBasePath } from '../utils/checkout-flow';
// THE WAITER — the same one as on the home screen (src/waiter): its voice session, how its replies are handled,
// its sheets and its dock. Never handle waiter replies in this page: change src/waiter and both pages follow.
import { useWaiterSession } from '../waiter/useWaiterSession';
import WaiterSheets, { WaiterDock } from '../waiter/WaiterSheets';
import {
  closedNote as closedNoteFor,
  formatAvailability,
  isAvailableAt,
  nextOpening,
  type AvailabilityWindow,
} from '../utils/availability';

/** Section heading with optional serving hours and description */
function SectionHeader({
  name,
  description,
  availability,
  open,
  opensAt,
}: {
  name: string;
  description?: string;
  availability?: AvailabilityWindow[];
  open: boolean;
  opensAt: string | null;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-base font-semibold text-gray-900 sm:text-lg">{name}</h2>
        {availability?.length ? (
          <span
            className={
              open
                ? 'text-[12px] text-gray-500'
                : 'rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-700'
            }
          >
            {open
              ? formatAvailability(availability)
              : `Available ${formatAvailability(availability)}${opensAt ? ` · opens ${opensAt}` : ''}`}
          </span>
        ) : null}
      </div>
      {description ? <p className="mt-0.5 text-[13px] text-gray-600">{description}</p> : null}
    </div>
  );
}

function useRuntimeRoute() {
  const { subdomain, branchSlug, branch } = useParams<{
    subdomain?: string;
    branchSlug?: string;
    branch?: string;
  }>();
  const [search] = useSearchParams();

  const sd =
    subdomain ??
    search.get('subdomain') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain ?? null : null);

  const branchFromParams = branch ?? branchSlug ?? undefined;

  const branchValue =
    branchFromParams ??
    search.get('branch') ??
    (typeof window !== 'undefined' ? (window as any).__STORE__?.branch ?? null : null);

  return { subdomain: sd, branchSlug: branchValue ?? undefined };
}

/* ========================================================================== */

export default function DigitalMenu() {
  const { subdomain, branchSlug } = useRuntimeRoute();
  // the same rule as every other page: the link decides ("…/dine-in/menu?table=12" = dine-in, "…/menu" = online)
  const channel: Channel = useOrderChannel(subdomain);
  const [fulfillment, setFulfillment] = useFulfillment(subdomain);
  const location = useLocation();

  if (!subdomain) return <Navigate to="/t/demo/menu" replace />;

  const normalizedBranch = branchSlug || undefined;

  /** TENANT INFO (optional) */
  const { data: tenant } = useQuery({
    queryKey: ['tenantInfo', subdomain],
    enabled: Boolean(subdomain),
    queryFn: async () => {
      const storeTenant =
        (typeof window !== 'undefined' ? (window as any).__STORE__?.tenant : undefined) ?? null;
      if (storeTenant) return storeTenant;
      return subdomain ? await getTenant(subdomain) : null;
    },
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  /** MENU (the visible grid) */
  const menuKey = ['publicMenu', { subdomain, branchSlug: normalizedBranch, channel }];
  const {
    data: items = [],
    isLoading: isMenuLoading,
    isError: isMenuError,
    error: menuError,
  } = useQuery({
    queryKey: menuKey,
    enabled: Boolean(subdomain),
    queryFn: () => listMenu({ subdomain: subdomain!, branch: normalizedBranch, channel }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  /** CATEGORIES */
  const catKey = ['publicCategories', { subdomain, branchSlug: normalizedBranch, channel }];
  const {
    data: categories = [],
    isLoading: isCatLoading,
    isError: isCatError,
  } = useQuery({
    queryKey: catKey,
    enabled: Boolean(subdomain),
    queryFn: async () => {
      try {
        return await listCategories({ subdomain: subdomain!, branch: normalizedBranch, channel });
      } catch {
        return [] as v1.CategoryDTO[];
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  /** Search (fuzzysort) */
  const [query, setQuery] = React.useState<string>('');

  interface SearchRow {
    _raw: v1.MenuItemDTO;
    name: string;
    description: string;
    category: string;
    tags: string;
  }

  /** Category name map (usable in rows and grouping) */
  const catNameById = new Map<string, string>();
  /** Server order (owner's drag & drop / PDF order), description and serving hours per category */
  const catMetaById = new Map<
    string,
    { index: number; description?: string; availability?: AvailabilityWindow[] }
  >();
  categories.forEach((c, index) => {
    const id = (c as any).id ?? (c as any)._id ?? (c as any).categoryId;
    const name = (c as any).name ?? (c as any).title ?? 'Untitled';
    if (!id) return;
    catNameById.set(String(id), String(name));
    catMetaById.set(String(id), {
      index,
      description: (c as any).description || undefined,
      availability: Array.isArray((c as any).availability) ? (c as any).availability : undefined,
    });
  });

  /** Opening hours + time zone (branch hours when the branch has its own) */
  const { data: hours } = useQuery({
    queryKey: ['publicHours', { subdomain, branchSlug: normalizedBranch }],
    enabled: Boolean(subdomain),
    queryFn: () => getHours(subdomain!, normalizedBranch),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const tz = hours?.timezone ?? null;
  const openingHours = hours?.openingHours ?? [];

  // Re-evaluate serving hours every minute
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const searchableRows: SearchRow[] = React.useMemo(() => {
    return items.map((it) => {
      const any = it as any;
      const categoryName =
        any.categoryName ??
        (any.category && (any.category.name || any.category.title)) ??
        (any.categoryId ? catNameById.get(String(any.categoryId)) : '') ??
        '';
      return {
        _raw: it,
        name: String(any.name ?? ''),
        description: String(any.description ?? any.subtitle ?? ''),
        category: String(categoryName ?? ''),
        tags: Array.isArray(any.tags) ? any.tags.map(String).join(' ') : '',
      };
    });
  }, [items, catNameById]);

  const filteredItems: v1.MenuItemDTO[] = React.useMemo(() => {
    const q = query.trim();
    if (!q) return items;

    const preparedRows = searchableRows.map((row) => ({
      ...row,
      namePrepared: Fuzzysort.prepare(row.name),
      descriptionPrepared: Fuzzysort.prepare(row.description),
      categoryPrepared: Fuzzysort.prepare(row.category),
      tagsPrepared: Fuzzysort.prepare(row.tags),
    }));

    const results = preparedRows
      .map((row) => {
        const nameResult = Fuzzysort.single(q, row.namePrepared);
        const descResult = Fuzzysort.single(q, row.descriptionPrepared);
        const catResult = Fuzzysort.single(q, row.categoryPrepared);
        const tagsResult = Fuzzysort.single(q, row.tagsPrepared);

        const nameScore = nameResult?.score ?? -100000;
        const descScore = descResult?.score ?? -100000;
        const catScore = catResult?.score ?? -100000;
        const tagsScore = tagsResult?.score ?? -100000;

        const totalScore = nameScore + descScore + catScore + tagsScore;
        const boostedScore = totalScore + Math.floor(nameScore * 0.7);

        return {
          row,
          boostedScore,
          hasMatch:
            nameScore > -100000 ||
            descScore > -100000 ||
            catScore > -100000 ||
            tagsScore > -100000,
        };
      })
      .filter((item) => item.hasMatch)
      .sort((a, b) => b.boostedScore - a.boostedScore)
      .map((item) => item.row._raw);

    return results;
  }, [items, query, searchableRows]);

  /** Group items by category (post-filter) */
  type Group = {
    name: string;
    items: v1.MenuItemDTO[];
    description?: string;
    availability?: AvailabilityWindow[];
    order: number;
  };
  type Grouped = Record<string, Group>;

  const grouped: Grouped = React.useMemo(() => {
    if (!filteredItems.length) return {};
    const acc: Grouped = {};
    const upsert = (key: string, name: string, item: v1.MenuItemDTO, catId?: string) => {
      if (!acc[key]) {
        const meta = catId ? catMetaById.get(catId) : undefined;
        acc[key] = {
          name,
          items: [],
          description: meta?.description,
          availability: meta?.availability,
          order: meta?.index ?? Number.MAX_SAFE_INTEGER,
        };
      }
      acc[key].items.push(item);
    };

    for (const item of filteredItems) {
      const anyItem = item as any;
      const catId: string | undefined =
        (anyItem.categoryId && String(anyItem.categoryId)) ||
        (Array.isArray(anyItem.categoryIds) && anyItem.categoryIds.length
          ? String(anyItem.categoryIds[0])
          : undefined) ||
        (anyItem.category &&
          (anyItem.category.id || anyItem.category._id) &&
          String(anyItem.category.id || anyItem.category._id)) ||
        undefined;

      const catName: string | undefined =
        (anyItem.categoryName && String(anyItem.categoryName)) ||
        (anyItem.category &&
          (anyItem.category.name || anyItem.category.title) &&
          String(anyItem.category.name || anyItem.category.title)) ||
        (catId && catNameById.get(catId)) ||
        undefined;

      if (catId || catName) {
        const key = catId ?? `name:${catName}`;
        const name = catName ?? catNameById.get(catId!) ?? 'Category';
        upsert(key, name, item, catId);
      } else {
        upsert('__uncategorized__', 'Uncategorized', item);
      }
    }

    // Owner-defined category order; unknown categories last, A–Z
    return Object.fromEntries(
      Object.entries(acc).sort(
        (a, b) => a[1].order - b[1].order || a[1].name.localeCompare(b[1].name),
      ),
    );
  }, [filteredItems, catNameById, catMetaById]);

  const sectionState = (g: Group) => {
    const open = isAvailableAt(g.availability, now, tz);
    return { open, opensAt: open ? null : nextOpening(g.availability, now, tz) };
  };

  const restaurantOpen = isAvailableAt(openingHours, now, tz);
  const opensAt = restaurantOpen ? null : nextOpening(openingHours, now, tz);

  /** Why an item can't be ordered now: restaurant closed → section hours → item hours */
  const itemClosedNote = (item: v1.MenuItemDTO, g?: Group) =>
    closedNoteFor({
      at: now,
      tz,
      openingHours,
      categoryHours: g?.availability,
      itemHours: (item as any).availability,
      itemFrom: (item as any).availableFrom,
      itemUntil: (item as any).availableUntil,
    }) ?? undefined;

  const hasCategories = Object.keys(grouped).length > 0 && !isCatError;

  /** Sections for pill bar */
  const sections = React.useMemo(() => {
    if (!hasCategories) return [] as Array<{ id: string; name: string; key?: string }>;
    const pairs = Object.entries(grouped);
    return [
      { id: 'all', name: 'All' },
      ...pairs.map(([key, g]) => ({ id: `cat-${key}`, name: g.name, key })),
    ];
  }, [grouped, hasCategories]);

  const [activeCatId, setActiveCatId] = React.useState<string>('all');

  React.useEffect(() => {
    if (!sections.length) return;
    const ids = new Set(sections.map((s) => s.id));
    if (!ids.has(activeCatId)) setActiveCatId('all');
  }, [sections, activeCatId]);

  const idToKey = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) if (s.key) m.set(s.id, s.key);
    return m;
  }, [sections]);

  // back to the waiter on the same side ("…/dine-in?table=12" or the online shop)
  const backHref = withTable(storeBasePath(subdomain, normalizedBranch) || '/', subdomain);

  const showSkeleton = isMenuLoading || isCatLoading;

  /* ======================= Infinite scroll (client) ======================== */
  const initialPageSize = React.useMemo(() => {
    if (typeof window === 'undefined') return 16;
    const w = window.innerWidth;
    if (w < 380) return 12;
    if (w < 640) return 16;
    if (w < 1024) return 20;
    return 28;
  }, []);

  const [visibleCount, setVisibleCount] = React.useState<number>(initialPageSize);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setVisibleCount(initialPageSize);
  }, [
    initialPageSize,
    query,
    activeCatId,
    channel,
    subdomain,
    normalizedBranch,
    filteredItems.length,
  ]);

  const totalItemsInView = React.useMemo(() => {
    if (hasCategories) {
      if (activeCatId === 'all') {
        return Object.values(grouped).reduce((sum, g) => sum + g.items.length, 0);
      }
      const k = idToKey.get(activeCatId);
      return k && grouped[k] ? grouped[k].items.length : 0;
    }
    return filteredItems.length;
  }, [hasCategories, activeCatId, grouped, idToKey, filteredItems.length]);

  const pageStep = React.useMemo(() => {
    if (typeof window === 'undefined') return 16;
    return window.innerWidth >= 1024 ? 24 : 12;
  }, []);

  React.useEffect(() => {
    if (!sentinelRef.current) return;
    if (visibleCount >= totalItemsInView) return;

    const node = sentinelRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisibleCount((c) => Math.min(c + pageStep, totalItemsInView));
          }
        }
      },
      { rootMargin: '600px 0px 600px 0px', threshold: 0.01 },
    );

    obs.observe(node);
    return () => obs.disconnect();
  }, [pageStep, totalItemsInView, visibleCount]);

  /* ===================== AI Waiter (shared with the home screen) ====================== */
  // the same voice session and reply handling as AIWaiterHome: cart changes, the option picker, offers, suggestion
  // cards, answer pills, the read-back / table / details steps. "Show me the menu" → we're already here.
  const w = useWaiterSession({ subdomain, branch: normalizedBranch, channel, onOpenMenu: () => {} });

  /* ============================== Rendering =============================== */

  const tenantSlug =
    subdomain ??
    ((typeof window !== 'undefined'
      ? (window as any).__STORE__?.subdomain
      : undefined) || undefined);
  const branchHint =
    normalizedBranch ??
    ((typeof window !== 'undefined'
      ? (window as any).__STORE__?.branch
      : undefined) || undefined);

  return (
    <div
      className="min-h-screen bg-[#F6F5F8] font-[Inter]"
      style={{
        fontFamily:
          'Inter, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial',
      }}
    >
      {/* Top Bar: Back + Title */}
      <div className="sticky top-0 z-30 bg-[#F6F5F8]">
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="relative flex items-center justify-between">
            <Link
              to={backHref}
              aria-label="Back"
              className="h-9 w-9 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm active:scale-95"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="#111827"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[22px] sm:text-[24px] font-semibold text-gray-900">
              Menu
            </h1>
            <LangSwitch value={w.selectedLang} onChange={w.setSelectedLang} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 pb-60">
        {/* Closed banner (opening hours, restaurant time zone) */}
        {!restaurantOpen && (
          <div
            role="status"
            className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800"
          >
            <span className="font-semibold">Closed now</span>
            {opensAt ? <> · opens {opensAt}</> : null}
            <span className="block text-[12px] text-amber-700">
              You can browse the menu; ordering opens during our hours ({formatAvailability(openingHours)}).
            </span>
          </div>
        )}

        {/* Search bar */}
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={(v) => setQuery(v)}
          className="mb-3"
        />

        {/* Category header + segmented switch */}
        <div className="mt-6 mb-6 flex items-center justify-between sm:mt-8 sm:mb-8">
          <h2 className="text-[20px] font-semibold text-gray-900">Category</h2>

          {/* online shop: pickup or delivery · dine-in guests already have a table, so no switch */}
          {channel === 'online' && <FulfillmentToggle value={fulfillment} onChange={setFulfillment} />}
        </div>

        {/* Content */}
        {showSkeleton ? (
          <RestaurantSkeleton />
        ) : isMenuError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load menu. {(menuError as Error)?.message ?? 'Unknown error'}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-600">
            No results for "{query}".
          </div>
        ) : Object.keys(grouped).length > 0 && !isCatError ? (
          // With categories
          (() => {
            const hasAll = activeCatId === 'all';
            return hasAll ? (
              <>
                <CategoryList
                  sections={[
                    { id: 'all', name: 'All' },
                    ...Object.entries(grouped).map(([key, g]) => ({
                      id: `cat-${key}`,
                      name: g.name,
                    })),
                  ]}
                  activeId={activeCatId}
                  onJump={(id) => setActiveCatId(id)}
                />

                <div className="space-y-8">
                  {(() => {
                    let remaining = visibleCount;
                    const blocks: JSX.Element[] = [];
                    for (const [key, group] of Object.entries(grouped)) {
                      if (remaining <= 0) break;
                      const slice = group.items.slice(0, Math.max(0, remaining));
                      if (slice.length > 0) {
                        blocks.push(
                          <section
                            key={key}
                            id={`cat-${key}`}
                            className="scroll-mt-20"
                          >
                            {(() => {
                              const st = sectionState(group);
                              return (
                                <>
                                  <SectionHeader
                                    name={group.name}
                                    description={group.description}
                                    availability={group.availability}
                                    open={st.open}
                                    opensAt={st.opensAt}
                                  />
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {slice.map((item) => (
                                      <ProductCard
                                        key={item.id}
                                        item={item}
                                        closedNote={itemClosedNote(item, group)}
                                      />
                                    ))}
                                  </div>
                                </>
                              );
                            })()}
                          </section>,
                        );
                        remaining -= slice.length;
                      } else {
                        break;
                      }
                    }
                    return blocks;
                  })()}
                </div>

                {visibleCount <
                  Object.values(grouped).reduce(
                    (sum, g) => sum + g.items.length,
                    0,
                  ) && <div ref={sentinelRef} className="h-10 w-full" />}
              </>
            ) : (
              (() => {
                const idToKeyLocal = new Map<string, string>(
                  Object.entries(grouped).map(([key]) => [`cat-${key}`, key]),
                );
                const key = idToKeyLocal.get(activeCatId);
                const g = key ? grouped[key] : undefined;
                if (!g) return null;
                const itemsSlice = g.items.slice(0, visibleCount);
                return (
                  <>
                    <CategoryList
                      sections={[
                        { id: 'all', name: 'All' },
                        ...Object.entries(grouped).map(([k, gg]) => ({
                          id: `cat-${k}`,
                          name: gg.name,
                        })),
                      ]}
                      activeId={activeCatId}
                      onJump={(id) => setActiveCatId(id)}
                    />
                    <section
                      id={`cat-${key}`}
                      className="scroll-mt-20"
                    >
                      {(() => {
                        const st = sectionState(g);
                        return (
                          <>
                            <SectionHeader
                              name={g.name}
                              description={g.description}
                              availability={g.availability}
                              open={st.open}
                              opensAt={st.opensAt}
                            />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {itemsSlice.map((item) => (
                                <ProductCard
                                  key={item.id}
                                  item={item}
                                  closedNote={itemClosedNote(item, g)}
                                />
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </section>
                    {visibleCount < g.items.length && (
                      <div ref={sentinelRef} className="h-10 w-full" />
                    )}
                  </>
                );
              })()
            );
          })()
        ) : (
          // Without categories
          <>
            <CategoryList
              sections={[{ id: 'all', name: 'All' }]}
              activeId={activeCatId}
              onJump={(id) => setActiveCatId(id)}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredItems.slice(0, visibleCount).map((item) => (
                <ProductCard key={item.id} item={item} closedNote={itemClosedNote(item)} />
              ))}
            </div>
            {visibleCount < filteredItems.length && (
              <div ref={sentinelRef} className="h-10 w-full" />
            )}
          </>
        )}

        {Array.isArray((tenant as any)?.menuNotes) && (tenant as any).menuNotes.length > 0 ? (
          <footer className="mt-10 border-t border-gray-200 pt-4 text-[12px] leading-relaxed text-gray-500">
            {((tenant as any).menuNotes as string[]).map((note) => (
              <p key={note}>{note}</p>
            ))}
          </footer>
        ) : null}

        {!isCatLoading && isCatError ? (
          <p className="mt-6 text-center text-xs text-gray-500">
            Categories not available yet. Showing items without grouping.
          </p>
        ) : null}
      </div>

      {/* the waiter's sheets (suggestions, the tray with its picker) — the same as on the home screen */}
      <WaiterSheets w={w} />

      {/* Floating minimized cart button (only when tray is closed & cart has items) */}
      <CartFab trayOpen={w.showTray} onOpenTray={() => w.setShowTray(true)} bottom={210} />

      {/* the waiter at the bottom: hold the orb to talk; what it says, and the answer pills */}
      <div className="fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto max-w-2xl">
          <WaiterDock w={w} originFromOrb={false} />
        </div>
      </div>
    </div>
  );
}
