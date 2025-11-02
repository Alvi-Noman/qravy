// apps/tastebud/src/pages/DigitalMenu.tsx
import React from 'react';
import { useLocation, useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Fuzzysort from 'fuzzysort';
import type { v1 } from '../../../../packages/shared/src/types';
import { listMenu, listCategories, getTenant, type Channel } from '../api/storefront';
import ProductCard from '../components/ProductCard';
import CategoryList from '../components/CategoryList';
import SearchBar from '../components/SearchBar';
import RestaurantSkeleton from '../components/RestaurantSkeleton';
import ChannelSwitch from '../components/ChannelSwitch';
import MicInputBar from '../components/ai-waiter/MicInputBar';

const SWITCH_FLAG_KEY = 'qravy:just-switched';
const SWITCH_DELAY_MS = 1000;     // show skeleton for ~1s after a switch
const SWITCH_VALID_MS = 1200;     // accept flag only if set <1.2s before navigation

function resolveChannelFromPath(pathname: string): Channel {
  const p = pathname.toLowerCase();
  return p.startsWith('/dine-in') || p.includes('/dine-in') ? 'dine-in' : 'online';
}

function useRuntimeRoute() {
  const { subdomain, branchSlug, branch } = useParams<{
    subdomain?: string;
    branchSlug?: string;
    branch?: string;
  }>();
  const location = useLocation();
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

  const channelFromPath = resolveChannelFromPath(location.pathname);
  const ch =
    (search.get('channel') as Channel | null) ??
    (typeof window !== 'undefined'
      ? ((window as any).__STORE__?.channel as Channel | null) ?? null
      : null) ??
    channelFromPath;

  return { subdomain: sd, branchSlug: branchValue ?? undefined, channel: ch as Channel };
}

/* ========================================================================== */

export default function DigitalMenu() {
  const { subdomain, branchSlug, channel } = useRuntimeRoute();
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

  /** MENU */
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
  for (const c of categories) {
    const id = (c as any).id ?? (c as any)._id ?? (c as any).categoryId;
    const name = (c as any).name ?? (c as any).title ?? 'Untitled';
    if (id) catNameById.set(String(id), String(name));
  }

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
            nameScore > -100000 || descScore > -100000 || catScore > -100000 || tagsScore > -100000,
        };
      })
      .filter((item) => item.hasMatch)
      .sort((a, b) => b.boostedScore - a.boostedScore)
      .map((item) => item.row._raw);

    return results;
  }, [items, query, searchableRows]);

  /** Group items by category (post-filter) */
  type Grouped = Record<string, { name: string; items: v1.MenuItemDTO[] }>;

  const grouped: Grouped = React.useMemo(() => {
    if (!filteredItems.length) return {};
    const acc: Grouped = {};
    const upsert = (key: string, name: string, item: v1.MenuItemDTO) => {
      if (!acc[key]) acc[key] = { name, items: [] };
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
        upsert(key, name, item);
      } else {
        upsert('__uncategorized__', 'Uncategorized', item);
      }
    }

    return Object.fromEntries(
      Object.entries(acc).sort((a, b) => a[1].name.localeCompare(b[1].name)),
    );
  }, [filteredItems, catNameById]);

  const hasCategories = Object.keys(grouped).length > 0 && !isCatError;

  /** Sections for pill bar */
  const sections = React.useMemo(() => {
    if (!hasCategories) return [] as Array<{ id: string; name: string; key?: string }>;
    const pairs = Object.entries(grouped);
    return [{ id: 'all', name: 'All' }, ...pairs.map(([key, g]) => ({ id: `cat-${key}`, name: g.name, key }))];
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

  // Route targets for the segmented switch
  const isDevPath = location.pathname.startsWith('/t/');
  const backHref = isDevPath
    ? (normalizedBranch ? `/t/${subdomain}/${normalizedBranch}` : `/t/${subdomain}`)
    : (normalizedBranch ? `/${normalizedBranch}` : `/`);

  const onlineHref =
    normalizedBranch ? `/t/${subdomain}/${normalizedBranch}/menu` : `/t/${subdomain}/menu`;
  const dineInHref =
    normalizedBranch
      ? `/t/${subdomain}/${normalizedBranch}/menu/dine-in`
      : `/t/${subdomain}/menu/dine-in`;

  /** Switch-only skeleton (never on initial load/refresh) */
  const [isSwitchSkeleton, setIsSwitchSkeleton] = React.useState(false);
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SWITCH_FLAG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; path: string } | null;
        sessionStorage.removeItem(SWITCH_FLAG_KEY); // one-shot: consume immediately
        if (
          parsed &&
          parsed.path === location.pathname &&
          Date.now() - parsed.ts <= SWITCH_VALID_MS
        ) {
          setIsSwitchSkeleton(true);
          const t = window.setTimeout(() => setIsSwitchSkeleton(false), SWITCH_DELAY_MS);
          return () => window.clearTimeout(t);
        }
      }
    } catch {
      /* ignore */
    }
  }, [location.pathname]);

  const markSwitch = React.useCallback((targetPath: string) => {
    try {
      sessionStorage.setItem(
        SWITCH_FLAG_KEY,
        JSON.stringify({ ts: Date.now(), path: targetPath })
      );
    } catch {
      /* ignore */
    }
  }, []);

  // SINGLE source of truth for skeleton:
  const showSkeleton = isSwitchSkeleton || isMenuLoading || isCatLoading;

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
  }, [initialPageSize, query, activeCatId, channel, subdomain, normalizedBranch, filteredItems.length]);

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
      { rootMargin: '600px 0px 600px 0px', threshold: 0.01 }
    );

    obs.observe(node);
    return () => obs.disconnect();
  }, [pageStep, totalItemsInView, visibleCount]);

  /* ============================== Rendering =============================== */

  // Safe runtime hints for mic bar
  const tenantSlug =
    subdomain ??
    ((typeof window !== 'undefined' ? (window as any).__STORE__?.subdomain : undefined) || undefined);
  const branchHint =
    normalizedBranch ??
    ((typeof window !== 'undefined' ? (window as any).__STORE__?.branch : undefined) || undefined);

  return (
    <div
      className="min-h-screen bg-[#F6F5F8] font-[Inter]"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial' }}
    >
      {/* Top Bar: Back + Title */}
      <div className="sticky top-0 z-30 bg-[#F6F5F8]">
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="flex items-center justify-between">
            <Link
              to={backHref}
              aria-label="Back"
              className="h-9 w-9 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-sm active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className="text-[22px] sm:text-[24px] font-semibold text-gray-900">Menu</h1>
            {/* spacer to keep title centered */}
            <span className="h-9 w-9" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 pb-28">
        {/* Search bar */}
        <SearchBar value={query} onChange={setQuery} onSubmit={(v) => setQuery(v)} className="mb-3" />

        {/* Category header + segmented switch */}
        <div className="mt-6 mb-6 flex items-center justify-between sm:mt-8 sm:mb-8">
          <h2 className="text-[20px] font-semibold text-gray-900">Category</h2>

          <ChannelSwitch
            channel={channel}
            dineInHref={
              normalizedBranch
                ? `/t/${subdomain}/${normalizedBranch}/menu/dine-in`
                : `/t/${subdomain}/menu/dine-in`
            }
            onlineHref={
              normalizedBranch
                ? `/t/${subdomain}/${normalizedBranch}/menu`
                : `/t/${subdomain}/menu`
            }
            showSkeleton={showSkeleton}
            onSwitch={(targetPath) => {
              try {
                sessionStorage.setItem(
                  SWITCH_FLAG_KEY,
                  JSON.stringify({ ts: Date.now(), path: targetPath })
                );
              } catch {}
            }}
          />
        </div>

        {/* ONE skeleton everywhere, otherwise full UI */}
        {showSkeleton ? (
          <RestaurantSkeleton />
        ) : isMenuError ? (
          <div className="rounded-xl border border-red-2 00 bg-red-50 p-4 text-sm text-red-700">
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
                  sections={[{ id: 'all', name: 'All' }, ...Object.entries(grouped).map(([key, g]) => ({ id: `cat-${key}`, name: g.name }))]}
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
                          <section key={key} id={`cat-${key}`} className="scroll-mt-20">
                            <h2 className="mb-3 text-base font-semibold text-gray-900 sm:text-lg">{group.name}</h2>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {slice.map((item) => (
                                <ProductCard key={item.id} item={item} />
                              ))}
                            </div>
                          </section>
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
                  Object.values(grouped).reduce((sum, g) => sum + g.items.length, 0) && (
                  <div ref={sentinelRef} className="h-10 w-full" />
                )}
              </>
            ) : (
              (() => {
                const idToKey = new Map<string, string>(
                  Object.entries(grouped).map(([key, g]) => [`cat-${key}`, key])
                );
                const key = idToKey.get(activeCatId);
                const g = key ? grouped[key] : undefined;
                if (!g) return null;
                const itemsSlice = g.items.slice(0, visibleCount);
                return (
                  <>
                    <CategoryList
                      sections={[{ id: 'all', name: 'All' }, ...Object.entries(grouped).map(([k, gg]) => ({ id: `cat-${k}`, name: gg.name }))]}
                      activeId={activeCatId}
                      onJump={(id) => setActiveCatId(id)}
                    />
                    <section id={`cat-${key}`} className="scroll-mt-20">
                      <h2 className="mb-3 text-base font-semibold text-gray-900 sm:text-lg">{g.name}</h2>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {itemsSlice.map((item) => (
                          <ProductCard key={item.id} item={item} />
                        ))}
                      </div>
                    </section>
                    {visibleCount < g.items.length && <div ref={sentinelRef} className="h-10 w-full" />}
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
                <ProductCard key={item.id} item={item} />
              ))}
            </div>
            {visibleCount < filteredItems.length && <div ref={sentinelRef} className="h-10 w-full" />}
          </>
        )}

        {!isCatLoading && isCatError ? (
          <p className="mt-6 text-center text-xs text-gray-500">
            Categories not available yet. Showing items without grouping.
          </p>
        ) : null}
      </div>

      {/* ✅ Sticky mic bar (bottom) — follows global language from AiWaiterHome */}
      <div className="sticky bottom-0 inset-x-0 z-40">
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="rounded-[999px] bg-white shadow-[0_12px_32px_rgba(250,40,81,0.08)] border border-gray-100 p-2">
            <MicInputBar
              tenant={tenantSlug}
              branch={branchHint}
              channel={channel}
              onAiReply={({ replyText, meta }) => {
                // You can optionally add-to-cart if meta.items present.
                console.debug('AI reply (DigitalMenu):', replyText, meta);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
