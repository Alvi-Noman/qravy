import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsUpDownIcon,
  TagIcon,
  PowerIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

/** Filter model (local to toolbar; matches page shape). */
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
  const [statusOpen, setStatusOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const statusRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Outside-click + Esc closes popovers
  useEffect(() => {
    if (!(statusOpen || catOpen || sortOpen)) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (statusOpen && statusRef.current && !statusRef.current.contains(t)) setStatusOpen(false);
      if (catOpen && catRef.current && !catRef.current.contains(t)) setCatOpen(false);
      if (sortOpen && sortRef.current && !sortRef.current.contains(t)) setSortOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatusOpen(false);
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
  }, [statusOpen, catOpen, sortOpen]);

  const appliedStatus = filters.status.size;
  const appliedCats = filters.categories.size;

  const setChannel = (tab: typeof CHANNEL_TABS[number]) => {
    if (tab === 'All channels') setFilters({ ...filters, channels: new Set() });
    else if (tab === 'Dine-In') setFilters({ ...filters, channels: new Set(['dine-in']) });
    else setFilters({ ...filters, channels: new Set(['online']) });
  };

  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Channel capsule */}
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
          {CHANNEL_TABS.map((t) => {
            const selected =
              (t === 'All channels' && filters.channels.size === 0) ||
              (t === 'Dine-In' && filters.channels.has('dine-in') && filters.channels.size === 1) ||
              (t === 'Online' && filters.channels.has('online') && filters.channels.size === 1);
            return (
              <button
                key={t}
                type="button"
                onClick={() => setChannel(t)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  selected ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Availability filter */}
        <div className="relative" ref={statusRef}>
          <button
            type="button"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
          >
            <PowerIcon className="h-4 w-4 text-[#6b7280]" />
            Availability
            {appliedStatus ? (
              <span className="ml-1 rounded-full bg-[#111827] px-1.5 py-0.5 text-xs text-white">{appliedStatus}</span>
            ) : null}
          </button>
          <AnimatePresence>
            {statusOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
              >
                <ul className="py-1 text-sm">
                  {[
                    { k: 'all', l: 'All' },
                    { k: 'active', l: 'Available' },
                    { k: 'hidden', l: 'Unavailable' },
                  ].map((o) => (
                    <li key={o.k}>
                      <button
                        type="button"
                        onClick={() => {
                          if (o.k === 'all') setFilters({ ...filters, status: new Set() });
                          else setFilters({ ...filters, status: new Set([o.k as 'active' | 'hidden']) });
                          setStatusOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left hover:bg-[#f5f5f5] ${
                          (o.k === 'all' && filters.status.size === 0) ||
                          (o.k !== 'all' && filters.status.has(o.k as any))
                            ? 'bg-[#f1f2f4] text-[#111827]'
                            : 'text-[#2e2e30]'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          {((o.k === 'all' && filters.status.size === 0) ||
                            (o.k !== 'all' && filters.status.has(o.k as any))) ? (
                            <CheckIcon className="h-4 w-4" />
                          ) : (
                            <span className="h-4 w-4" />
                          )}
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

        {/* Category filter (card list with All at top) */}
        <div className="relative" ref={catRef}>
          <button
            type="button"
            aria-expanded={catOpen}
            onClick={() => setCatOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] hover:bg-[#f5f5f5]"
          >
            <TagIcon className="h-4 w-4 text-[#6b7280]" />
            All
            {appliedCats ? (
              <span className="ml-1 rounded-full bg-[#111827] px-1.5 py-0.5 text-xs text-white">{appliedCats}</span>
            ) : null}
          </button>
          <AnimatePresence>
            {catOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
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
                        filters.categories.size === 0 ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                      }`}
                    >
                      <span>All</span>
                      {filters.categories.size === 0 ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                    </button>
                  </li>

                  {categories.map((c) => {
                    const active = filters.categories.has(c);
                    return (
                      <li key={c}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = new Set(filters.categories);
                            if (next.has(c)) next.delete(c);
                            else next.add(c);
                            setFilters({ ...filters, categories: next });
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

                  {categories.length === 0 && <li className="px-3 py-6 text-center text-[#6b7280]">No categories</li>}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right side: search and sort */}
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[260px] max-w-[520px] flex-1 items-center">
          {/* Search */}
          <div className="flex min-w-[260px] flex-1 items-center rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 focus-within:border-[#111827]">
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

          {/* Sort */}
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