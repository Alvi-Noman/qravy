// apps/braincell/src/components/menu-items/MenuToolbar.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  Squares2X2Icon,
  TagIcon,
} from '@heroicons/react/24/outline';
import { useScope } from '../../context/ScopeContext';

type Status = 'active' | 'hidden';
type Channel = 'dine-in' | 'online';
export type SortBy = 'name-asc' | 'created-desc' | 'most-used';

const CHANNEL_TABS = ['All channels', 'Dine-In', 'Online'] as const;

export default function MenuToolbar({
  q,
  setQ,
  status,
  setStatus,
  channels,
  setChannels,
  categories,
  selectedCategory,
  setSelectedCategory,
  sortBy,
  setSortBy,
  channelAlerts,
}: {
  q: string;
  setQ: (v: string) => void;
  status: Set<Status>;
  setStatus: (v: Set<Status>) => void;
  channels: Set<Channel>;
  setChannels: (v: Set<Channel>) => void;
  categories: string[];
  selectedCategory: string | '';
  setSelectedCategory: (v: string) => void;
  sortBy: SortBy;
  setSortBy: (v: SortBy) => void;
  // Optional channel alert flags: show a red dot if at least one item is OFF in that channel but ON in the other
  channelAlerts?: { dineIn: boolean; online: boolean };
}) {
  // Global channel scope
  const { channel, setChannel } = useScope();

  // Sync local filter state with global channel scope (list filtering is handled by fetch; this is UI only)
  useEffect(() => {
    if (channel === 'all') setChannels(new Set());
    else if (channel === 'dine-in') setChannels(new Set(['dine-in']));
    else setChannels(new Set(['online']));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  // Channels capsule
  const isAllChannels = channel === 'all';
  const selectedChannelIdx = channel === 'all' ? 0 : channel === 'dine-in' ? 1 : 2;

  const setChannelTab = (tab: typeof CHANNEL_TABS[number]) => {
    if (tab === 'All channels') {
      setChannel('all');
      setChannels(new Set());
    } else if (tab === 'Dine-In') {
      setChannel('dine-in');
      setChannels(new Set(['dine-in']));
    } else {
      setChannel('online');
      setChannels(new Set(['online']));
    }
  };

  const channelCapsuleRef = useRef<HTMLDivElement>(null);
  const channelTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [channelIndicator, setChannelIndicator] = useState({ left: 0, width: 0 });

  const recalcChannelIndicator = () => {
    const btn = channelTabRefs.current[selectedChannelIdx];
    if (!btn) return;
    setChannelIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
  };

  useLayoutEffect(() => {
    recalcChannelIndicator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    recalcChannelIndicator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelIdx]);

  useEffect(() => {
    const onResize = () => recalcChannelIndicator();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Popovers
  const [statusOpen, setStatusOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (statusOpen && statusRef.current && !statusRef.current.contains(t)) setStatusOpen(false);
      if (catOpen && catRef.current && !catRef.current.contains(t)) setCatOpen(false);
      if (sortOpen && sortRef.current && !sortRef.current.contains(t)) setSortOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && (setStatusOpen(false), setCatOpen(false), setSortOpen(false));
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [statusOpen, catOpen, sortOpen]);

  const availabilityLabel = useMemo(() => {
    if (status.size === 0) return 'All Items';
    if (status.has('active')) return 'Available Items';
    return 'Unavailable Items';
  }, [status]);

  const categoryLabel = useMemo(() => selectedCategory || 'All Categories', [selectedCategory]);

  const Dot = ({ show }: { show?: boolean }) =>
    show ? <span className="ml-1 inline-block h-2 w-2 rounded-full bg-red-500" /> : null;

  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Channels capsule */}
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
            const withDot =
              (t === 'Dine-In' && channelAlerts?.dineIn) ||
              (t === 'Online' && channelAlerts?.online);
            return (
              <button
                key={t}
                role="tab"
                aria-selected={selected}
                ref={(el) => (channelTabRefs.current[i] = el)}
                type="button"
                onClick={() => setChannelTab(t)}
                className={`relative z-10 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  selected ? 'text-slate-900' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                <span className="inline-flex items-center">
                  {t}
                  <Dot show={withDot} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Availability */}
        <div className="relative" ref={statusRef}>
          <button
            type="button"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((v) => !v)}
            className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-[#f6f6f6] ${
              status.size === 0 ? 'border-[#dbdbdb] bg-[#fcfcfc]' : 'border-black bg-[#fcfcfc]'
            }`}
          >
            <Squares2X2Icon className="h-5 w-5 text-slate-600" />
            <span className="truncate font-medium text-slate-900">{availabilityLabel}</span>
          </button>
          <AnimatePresence>
            {statusOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
              >
                <ul className="py-1">
                  {[
                    { key: 'all', label: 'All Items' },
                    { key: 'active', label: 'Available Items' },
                    { key: 'hidden', label: 'Unavailable Items' },
                  ].map((opt) => {
                    const selected =
                      (opt.key === 'all' && status.size === 0) ||
                      (opt.key !== 'all' && status.has(opt.key as Status));
                    return (
                      <li key={opt.key}>
                        <button
                          type="button"
                          onClick={() => {
                            if (opt.key === 'all') setStatus(new Set());
                            if (opt.key === 'active') setStatus(new Set(['active']));
                            if (opt.key === 'hidden') setStatus(new Set(['hidden']));
                            setStatusOpen(false);
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

        {/* Categories */}
        <div className="relative" ref={catRef}>
          <button
            type="button"
            aria-expanded={catOpen}
            onClick={() => setCatOpen((v) => !v)}
            className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-[#f6f6f6] ${
              selectedCategory ? 'border-black bg-[#fcfcfc]' : 'border-[#dbdbdb] bg-[#fcfcfc]'
            }`}
          >
            <TagIcon className="h-5 w-5 text-slate-600" />
            <span className="truncate font-medium text-slate-900">{categoryLabel}</span>
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
                <ul className="max-h-72 overflow-y-auto py-1">
                  <li key="__all">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory('');
                        setCatOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 hover:bg-[#f5f5f5] ${
                        !selectedCategory ? 'bg-[#f1f2f4] text-[#111827]' : 'text-[#2e2e30]'
                      }`}
                    >
                      <span>All Categories</span>
                      {!selectedCategory ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                    </button>
                  </li>
                  {categories.map((c) => {
                    const active = selectedCategory === c;
                    return (
                      <li key={c}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCategory(c);
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

      {/* Search + Sort */}
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[320px] max-w-[680px] flex-1 items-center">
          <div className="flex min-w-[320px] flex-1 items-center rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 focus-within:border-[#111827]">
            <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items"
              className="min-w-0 flex-1 bg-transparent placeholder-[#a9a9ab] focus:outline-none"
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
              className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 hover:bg-[#f5f5f5]"
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
                  <ul className="py-1">
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