// apps/tastebud/src/pages/DigitalMenu.tsx
import React from 'react';
import {
  useLocation,
  useParams,
  useSearchParams,
  Link,
  Navigate,
  useNavigate,
} from 'react-router-dom';
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
import SuggestionsModal from '../components/ai-waiter/SuggestionsModal';
import TrayModal from '../components/ai-waiter/CartModal';
import CartFab from '../components/ai-waiter/CartFab';
import { useCart } from '../context/CartContext';
import type { AiReplyMeta, WaiterIntent } from '../types/waiter-intents';
import { normalizeIntent, localHeuristicIntent } from '../utils/intent-routing';
import { usePublicMenu } from '../hooks/usePublicMenu';
import { applyVoiceCartOps } from '../utils/voice-cart';

const SWITCH_FLAG_KEY = 'qravy:just-switched';
const SWITCH_DELAY_MS = 1000;
const SWITCH_VALID_MS = 1200;

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
  const effectiveLang = 'bn';
  const location = useLocation();
  const navigate = useNavigate();
  const { addItem, setQty, updateQty, removeItem, clear } = useCart();

  if (!subdomain) return <Navigate to="/t/demo/menu" replace />;

  const normalizedBranch = branchSlug || undefined;

  /** Full menu for voice cart ops (shared catalog) */
  const { items: fullMenuItems = [] } = usePublicMenu(subdomain, normalizedBranch, channel);

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

  /** MENU (for visible grid; can be same as fullMenuItems but kept separate for now) */
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

  // Route targets for the segmented switch
  const isDevPath = location.pathname.startsWith('/t/');
  const backHref = isDevPath
    ? normalizedBranch
      ? `/t/${subdomain}/${normalizedBranch}`
      : `/t/${subdomain}`
    : normalizedBranch
    ? `/${normalizedBranch}`
    : `/`;

  const onlineHref =
    normalizedBranch ? `/t/${subdomain}/${normalizedBranch}/menu` : `/t/${subdomain}/menu`;
  const dineInHref =
    normalizedBranch
      ? `/t/${subdomain}/${normalizedBranch}/menu/dine-in`
      : `/t/${subdomain}/menu/dine-in`;

  const confirmationHref =
    normalizedBranch
      ? `/t/${subdomain}/${normalizedBranch}/confirmation`
      : `/t/${subdomain}/confirmation`;

  /** Switch-only skeleton */
  const [isSwitchSkeleton, setIsSwitchSkeleton] = React.useState(false);
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SWITCH_FLAG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; path: string } | null;
        sessionStorage.removeItem(SWITCH_FLAG_KEY);
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
    } catch {}
  }, [location.pathname]);

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

  /* ===================== AI Waiter: intent → modals ======================= */

  type SuggestedItem = {
    id?: string;
    name?: string;
    price?: number;
    imageUrl?: string;
  };

  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [showTray, setShowTray] = React.useState(false);
  const [suggestedItems, setSuggestedItems] = React.useState<SuggestedItem[]>([]);
  const [upsellItems, setUpsellItems] = React.useState<
    { itemId?: string; id?: string; title: string; price?: number }[]
  >([]);

  // store latest AI reply meta
  const [aiReplyMeta, setAiReplyMeta] = React.useState<AiReplyMeta | null>(null);

  const openSuggestions = () => {
    setShowTray(false);
    setShowSuggestions(true);
  };

  const openTray = () => {
    setShowSuggestions(false);
    setShowTray(true);
  };

  const resolveMenuItem = (id?: string, name?: string) => {
    const src = (items as any[]) || [];
    if (!src.length) return undefined as any;

    if (id) {
      const hit = src.find((m) => String(m.id) === String(id));
      if (hit) return hit;
    }
    if (name) {
      const lc = String(name).toLowerCase();
      const hit = src.find((m) => String(m.name || '').toLowerCase() === lc);
      if (hit) return hit;
    }
    return undefined as any;
  };

  const buildSuggestionsFromMeta = (meta?: AiReplyMeta): SuggestedItem[] => {
    if (!meta) return [];
    const out: SuggestedItem[] = [];

    const metaSuggestions = Array.isArray(meta.suggestions) ? meta.suggestions : [];
    for (const s of metaSuggestions as any[]) {
      const itemId = s.itemId || s.id;
      const src = resolveMenuItem(itemId, s.title || s.name);
      if (src) {
        out.push({
          id: String(src.id),
          name: src.name,
          price: typeof src.price === 'number' ? src.price : undefined,
          imageUrl: src.imageUrl ?? src.image ?? undefined,
        });
      }
    }

    const metaItems = Array.isArray(meta.items) ? meta.items : [];
    for (const it of metaItems as any[]) {
      const itemId = it.itemId || it.id;
      const src = resolveMenuItem(itemId, it.name);
      if (src) {
        out.push({
          id: String(src.id),
          name: src.name,
          price: typeof src.price === 'number' ? src.price : undefined,
          imageUrl: src.imageUrl ?? src.image ?? undefined,
        });
      }
    }

    const seen = new Set<string>();
    return out.filter((x) => {
      const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const buildSuggestionsFromReplyText = (replyText: string): SuggestedItem[] => {
    if (!replyText || !items || !items.length) return [];
    const lc = replyText.toLowerCase();
    const hits: SuggestedItem[] = [];

    for (const s of items as any[]) {
      const name = (s?.name ?? '').toString();
      if (!name) continue;

      const nameHit = lc.includes(name.toLowerCase());
      const aliases: string[] = Array.isArray(s?.aliases) ? s.aliases : [];
      const aliasHit = aliases.some((a) => lc.includes(String(a).toLowerCase()));

      if (nameHit || aliasHit) {
        hits.push({
          id: String(s.id),
          name: s.name,
          price: typeof s.price === 'number' ? s.price : undefined,
          imageUrl: s.imageUrl ?? s.image ?? undefined,
        });
      }
    }

    const seen = new Set<string>();
    return hits.filter((x) => {
      const key = `${x.id ?? ''}|${(x.name ?? '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const resolveIntent = (meta?: AiReplyMeta, replyText?: string): WaiterIntent => {
    if (meta?.intent) return normalizeIntent(meta.intent);
    if (Array.isArray(meta?.items) && meta.items.length) return 'order';
    return localHeuristicIntent(replyText || '');
  };

  // Central router:
  // - main MicInputBar
  // - SuggestionsModal.onIntent
  // - TrayModal.onIntent
  const handleIntent = (
    rawIntent: WaiterIntent | undefined,
    meta?: AiReplyMeta,
    replyText?: string,
  ) => {
    const intent = rawIntent ?? resolveIntent(meta, replyText);
    const decision = (meta?.decision || {}) as any;

    // 🔁 Global confirmation redirect: if backend says so, go straight to confirmation page
    if (decision?.openConfirmationPage) {
      navigate(confirmationHref);
      return;
    }

    const hasCartOps = Array.isArray(meta?.cartOps) && meta!.cartOps.length > 0;
    const didClear = !!meta?.clearCart;

    const menuSource =
      (fullMenuItems && fullMenuItems.length ? fullMenuItems : items) as any[];

    // 1) Apply voice cart ops (single source of truth for cart mutations)
    if (meta && (hasCartOps || didClear)) {
      try {
        applyVoiceCartOps(meta, menuSource, {
          addItem,
          setQty,
          updateQty,
          removeItem,
          clear,
        });
      } catch {
        // ignore bad ops
      }

      const upsell = (meta.upsell || (meta as any).Upsell || []) as any[];

      if (decision?.showUpsellTray && Array.isArray(upsell) && upsell.length) {
        setUpsellItems(
          upsell.map((u: any) => ({
            id: u.itemId || u.id,
            itemId: u.itemId || u.id,
            title: String(u.title || u.name || ''),
            price: typeof u.price === 'number' ? u.price : undefined,
          })),
        );
      }

      // If AI touched cart, default to showing tray unless it clearly wanted suggestions/menu.
      if (!intent || intent === 'order' || intent === 'chitchat') {
        openTray();
      }
    }

    // 2) Suggestions intent
    if (intent === 'suggestions') {
      let mapped = buildSuggestionsFromMeta(meta);

      if ((!mapped || !mapped.length) && replyText) {
        mapped = buildSuggestionsFromReplyText(replyText);
      }

      if ((!mapped || !mapped.length) && items && items.length) {
        mapped = (items as any[])
          .slice(0, Math.min(8, (items as any[]).length))
          .map((it: any) => ({
            id: String(it.id),
            name: it.name,
            price: typeof it.price === 'number' ? it.price : undefined,
            imageUrl: it.imageUrl ?? it.image ?? undefined,
          }));
      }

      setSuggestedItems(mapped);
      openSuggestions();
      return;
    }

    // 3) Order intent (fallback when no cartOps were emitted)
    if (intent === 'order') {
      if (!hasCartOps && meta) {
        const orderItems = Array.isArray(meta.items) ? (meta.items as any[]) : [];

        for (const it of orderItems) {
          const src = resolveMenuItem(it.itemId, it.name);
          if (!src) continue;

          const qty = Math.max(1, Number(it.quantity ?? 1));
          const price =
            (typeof (src as any).price === 'number' ? (src as any).price : undefined) ??
            (typeof it.price === 'number' ? it.price : 0);

          addItem({
            id: String((src as any).id),
            name: (src as any).name ?? it.name ?? '',
            price,
            qty,
          });
        }

        const upsell = (meta.upsell || (meta as any).Upsell || []) as any[];

        if (decision?.showUpsellTray && Array.isArray(upsell) && upsell.length) {
          setUpsellItems(
            upsell.map((u: any) => ({
              id: u.itemId || u.id,
              itemId: u.itemId || u.id,
              title: String(u.title || u.name || ''),
              price: typeof u.price === 'number' ? u.price : undefined,
            })),
          );
        }
      }

      openTray();
      return;
    }

    // 4) intent === 'menu' → we're already here
    // 5) intent === 'chitchat' → no modal change
  };

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

  // Log what modals will see (non-JSX, avoids ReactNode issues)
  console.log('[MODAL PROPS]', {
    source: 'DigitalMenu',
    suggestions: aiReplyMeta?.suggestions || [],
    upsell: aiReplyMeta?.upsell || [],
  });

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
          <div className="flex items-center justify-between">
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
            <h1 className="text-[22px] sm:text-[24px] font-semibold text-gray-900">
              Menu
            </h1>
            <span className="h-9 w-9" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 pb-28">
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

          <ChannelSwitch
            channel={channel}
            dineInHref={dineInHref}
            onlineHref={onlineHref}
            showSkeleton={showSkeleton}
            onSwitch={(targetPath) => {
              try {
                sessionStorage.setItem(
                  SWITCH_FLAG_KEY,
                  JSON.stringify({ ts: Date.now(), path: targetPath }),
                );
              } catch {}
            }}
          />
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
                            <h2 className="mb-3 text-base font-semibold text-gray-900 sm:text-lg">
                              {group.name}
                            </h2>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {slice.map((item) => (
                                <ProductCard key={item.id} item={item} />
                              ))}
                            </div>
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
                      <h2 className="mb-3 text-base font-semibold text-gray-900 sm:text-lg">
                        {g.name}
                      </h2>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {itemsSlice.map((item) => (
                          <ProductCard key={item.id} item={item} />
                        ))}
                      </div>
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
                <ProductCard key={item.id} item={item} />
              ))}
            </div>
            {visibleCount < filteredItems.length && (
              <div ref={sentinelRef} className="h-10 w-full" />
            )}
          </>
        )}

        {!isCatLoading && isCatError ? (
          <p className="mt-6 text-center text-xs text-gray-500">
            Categories not available yet. Showing items without grouping.
          </p>
        ) : null}
      </div>

      {/* Modals driven by AI Waiter intents (backend-driven meta) */}
      <SuggestionsModal
        open={showSuggestions}
        onClose={() => setShowSuggestions(false)}
        items={suggestedItems}
        onIntent={(intent, meta, replyText) => {
          const m = (meta as AiReplyMeta | undefined) ?? aiReplyMeta ?? undefined;
          console.log('[AI PAGE][SuggestionsModal.onIntent]', { intent, meta: m, replyText });
          handleIntent(intent, m, replyText);
        }}
      />
      <TrayModal
        open={showTray}
        onClose={() => setShowTray(false)}
        upsellItems={upsellItems}
        onIntent={(intent, meta, replyText) => {
          const m = (meta as AiReplyMeta | undefined) ?? aiReplyMeta ?? undefined;
          console.log('[AI PAGE][TrayModal.onIntent]', { intent, meta: m, replyText });
          handleIntent(intent, m, replyText);
        }}
      />

      {/* Floating minimized cart button (only when tray is closed & cart has items) */}
      <CartFab
        trayOpen={showTray}
        onOpenTray={() => setShowTray(true)}
      />

      {/* Sticky mic bar (bottom) */}
      <div className="sticky bottom-0 inset-x-0 z-40">
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="rounded-[999px] bg-white shadow-[0_12px_32px_rgba(250,40,81,0.08)] border border-gray-100 p-2">
            <MicInputBar
              tenant={tenantSlug}
              branch={branchHint}
              channel={channel}
              lang={effectiveLang}
              onAiReply={({ replyText, meta }) => {
                const m = meta as AiReplyMeta | undefined;
                console.log('[AI PAGE]', { replyText, meta: m });
                setAiReplyMeta(m ?? null);
                handleIntent(undefined, m, replyText);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
