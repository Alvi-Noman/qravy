import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  Squares2X2Icon, // All Items icon (4-box)
  TagIcon,        // Categories icon (same as sidebar)
} from '@heroicons/react/24/outline';

type Filters = {
  status: Set<'active' | 'hidden'>;
  channels: Set<'dine-in' | 'online'>;
  categories: Set<string>;
};

const CHANNEL_TABS = ['All channels', 'Dine-In', 'Online'] as const;

export default function MenuItemsToolbar({
  q,
  setQ,
  filters,
  setFilters,
  categories,
  sortBy,
  setSortBy,
}: {
  q: string;
  setQ: (v: string) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  categories: string[];
  sortBy: 'name-asc' | 'created-desc' | 'most-used';
  setSortBy: (v: 'name-asc' | 'created-desc' | 'most-used') => void;
}) {
  const [availOpen, setAvailOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const availRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!(availOpen || catOpen || sortOpen)) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (availOpen && availRef.current && !availRef.current.contains(t)) setAvailOpen(false);
      if (catOpen && catRef.current && !catRef.current.contains(t)) setCatOpen(false);
      if (sortOpen && sortRef.current && !sortRef.current.contains(t)) setSortOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAvailOpen(false);
        setCatOpen(false);
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [availOpen, catOpen, sortOpen]);

  // CHANNELS — sliding capsule + black outline when not "All channels"
  const isAllChannels = filters.channels.size === 0;
  const selectedChannelIdx = isAllChannels ? 0 : filters.channels.has('dine-in') ? 1 : 2;

  const setChannel = (tab: typeof CHANNEL_TABS[number]) => {
    if (tab === 'All channels') setFilters({ ...filters, channels: new Set() });
    else if (tab === 'Dine-In') setFilters({ ...filters, channels: new Set(['dine-in']) });
    else setFilters({ ...filters, channels: new Set(['online']) });
  };

  const channelCapsuleRef = useRef<HTMLDivElement>(null);
  const channelTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [channelIndicator, setChannelIndicator] = useState({ left: 0, width: 0 });
  const recalcChannelIndicator = () => {
    const btn = channelTabRefs.current[selectedChannelIdx];
    const cap = channelCapsuleRef.current;
    if (!btn || !cap) return;
    setChannelIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
  };
  useLayoutEffect(() => {
    recalcChannelIndicator();
  }, []);
  useLayoutEffect(() => {
    recalcChannelIndicator();
  }, [selectedChannelIdx]);
  useEffect(() => {
    const onResize = () => recalcChannelIndicator();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Availability label (icon always the 4-box)
  const isAllItems = filters.status.size === 0;
  const availabilityLabel = isAllItems
    ? 'All Items'
    : filters.status.has('active')
    ? 'Available Items'
    : 'Unavailable Items';

  // Category label (single-select)
  const isAllCategories = filters.categories.size === 0;
  const categoryButtonLabel = isAllCategories
    ? 'All Categories'
    : Array.from(filters.categories)[0] || 'All Categories';

  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Channels capsule (black outline when narrowed) */}
        <div
          ref={channelCapsuleRef}
          role="tablist"
          aria-label="Channels"
          className={`relative flex items-center gap-1 rounded-md p-1 bg-slate-100 border ${
            isAllChannels ? 'border-slate-200' : 'border-black'
          }`}
        >
          <motion.span
            initial={false}
            className="absolute top-1 bottom-1 rounded-md bg-white shadow-sm ring-1 ring-slate-200"
            animate={{ left: channelIndicator.left, width: channelIndicator.width }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          />
          {CHANNEL_TABS.map((t, i) => {
            const selected = i === selectedChannelIdx;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={selected}
                ref={(el) => (channelTabRefs.current[i] = el)}
                type="button"
                onClick={() => setChannel(t)}
                className={`relative z-10 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selected ? 'text-slate-900' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Horizontal dash separator */}
        <span aria-hidden="true" className="px-1 select-none text-slate-400">—</span>

        {/* Availability selector (match sidebar icon size/spacing; black outline when not All Items) */}
        <div className="relative" ref={availRef}>
          <button
            type="button"
            aria-expanded={availOpen}
            onClick={() => setAvailOpen((v) => !v)}
            className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[14px] text-slate-700 transition-colors hover:bg-[#f6f6f6] ${
              isAllItems ? 'border-[#dbdbdb] bg-[#fcfcfc]' : 'border-black bg-[#fcfcfc]'
            }`}
          >
            <Squares2X2Icon className="h-5 w-5 text-slate-600" />
            <span className="truncate font-medium text-slate-900">{availabilityLabel}</span>
          </button>
          <AnimatePresence>
            {availOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
              >
                <ul className="py-1 text-sm">
                  {[
                    { key: 'all', label: 'All Items' },
                    { key: 'active', label: 'Available Items' },
                    { key: 'hidden', label: 'Unavailable Items' },
                  ].map((opt) => {
                    const selected =
                      (opt.key === 'all' && filters.status.size === 0) ||
                      (opt.key !== 'all' && filters.status.has(opt.key as 'active' | 'hidden'));
                    return (
                      <li key={opt.key}>
                        <button
                          type="button"
                          onClick={() => {
                            if (opt.key === 'all') setFilters({ ...filters, status: new Set() });
                            if (opt.key === 'active') setFilters({ ...filters, status: new Set(['active']) });
                            if (opt.key === 'hidden') setFilters({ ...filters, status: new Set(['hidden']) });
                            setAvailOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 hover:bg-[#f5f5f5] ${
                            selected ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                          }`}
                        >
                          <span>{opt.label}</span>
                          {selected ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Category selector (use TagIcon; same size/spacing; black outline when not All Categories) */}
        <div className="relative" ref={catRef}>
          <button
            type="button"
            aria-expanded={catOpen}
            onClick={() => setCatOpen((v) => !v)}
            className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[14px] text-slate-700 transition-colors hover:bg-[#f6f6f6] ${
              isAllCategories ? 'border-[#dbdbdb] bg-[#fcfcfc]' : 'border-black bg-[#fcfcfc]'
            }`}
          >
            <TagIcon className="h-5 w-5 text-slate-600" />
            <span className="truncate font-medium text-slate-900">{categoryButtonLabel}</span>
          </button>
          <AnimatePresence>
            {catOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute left-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
              >
                <ul className="max-h-72 overflow-y-auto py-1 text-sm">
                  <li key="__all">
                    <button
                      type="button"
                      onClick={() => {
                        setFilters({ ...filters, categories: new Set() });
                        setCatOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 hover:bg-[#f5f5f5] ${
                        isAllCategories ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                      }`}
                    >
                      <span>All Categories</span>
                      {isAllCategories ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                    </button>
                  </li>

                  {categories.map((c) => {
                    const active = filters.categories.size === 1 && filters.categories.has(c);
                    return (
                      <li key={c}>
                        <button
                          type="button"
                          onClick={() => {
                            setFilters({ ...filters, categories: new Set([c]) });
                            setCatOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 hover:bg-[#f5f5f5] ${
                            active ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                          }`}
                        >
                          <span>{c}</span>
                          {active ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                        </button>
                      </li>
                    );
                  })}

                  {categories.length === 0 && (
                    <li className="px-3 py-6 text-center text-[#6b7280]">No categories</li>
                  )}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right side: search and sort */}
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[320px] max-w-[680px] flex-1 items-center">
          <div className="flex min-w-[320px] flex-1 items-center rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 focus-within:border-[#111827]">
            <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#2e2e30] placeholder-[#a9a9ab] focus:outline-none focus:ring-0"
            />
            {q ? (
              <button aria-label="Clear" className="text-[#6b7280] hover:text-[#111827]" onClick={() => setQ('')}>
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="relative ml-2" ref={sortRef}>
            <button
              type="button"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
            >
              <ArrowsUpDownIcon className="h-4 w-4 text-[#6b7280]" />
              {sortBy === 'name-asc' && 'Name (A–Z)'}
              {sortBy === 'created-desc' && 'Recently created'}
              {sortBy === 'most-used' && 'Most used'}
            </button>
            <AnimatePresence>
              {sortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
                >
                  <ul className="py-1 text-sm">
                    {[
                      { k: 'name-asc', l: 'Name (A–Z)' },
                      { k: 'created-desc', l: 'Recently created' },
                      { k: 'most-used', l: 'Most used' },
                    ].map((o) => (
                      <li key={o.k}>
                        <button
                          type="button"
                          onClick={() => {
                            setSortBy(o.k as any);
                            setSortOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left hover:bg-[#f5f5f5] ${
                            sortBy === (o.k as any) ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            {sortBy === (o.k as any) ? <CheckIcon className="h-4 w-4" /> : <span className="h-4 w-4" />}
                            {o.l}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}