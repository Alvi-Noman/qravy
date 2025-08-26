import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const CHANNEL_TABS = ['All channels', 'Dine-In', 'Online'] as const;

export default function CategoriesToolbar({
  q,
  setQ,
  channels,
  setChannels,
  sortBy,
  setSortBy,
}: {
  q: string;
  setQ: (v: string) => void;
  channels: Set<'dine-in' | 'online'>;
  setChannels: (v: Set<'dine-in' | 'online'>) => void;
  sortBy: 'name-asc' | 'created-desc' | 'most-used';
  setSortBy: (v: 'name-asc' | 'created-desc' | 'most-used') => void;
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // CHANNELS — sliding capsule (same as items)
  const isAllChannels = channels.size === 0;
  const selectedChannelIdx = isAllChannels ? 0 : channels.has('dine-in') ? 1 : 2;

  const setChannel = (tab: typeof CHANNEL_TABS[number]) => {
    if (tab === 'All channels') setChannels(new Set());
    else if (tab === 'Dine-In') setChannels(new Set(['dine-in']));
    else setChannels(new Set(['online']));
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

  // Close sort on outside/esc
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (sortOpen && sortRef.current && !sortRef.current.contains(t)) setSortOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setSortOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [sortOpen]);

  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
      </div>

      {/* Right side: search and sort */}
      <div className="flex items-center gap-2">
        <div className="ml-auto flex min-w-[320px] max-w-[680px] flex-1 items-center">
          <div className="flex min-w-[320px] flex-1 items-center rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 focus-within:border-[#111827]">
            <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search categories"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#2e2e30] placeholder-[#a9a9ab] focus:outline-none focus:ring-0"
            />
            {q ? (
              <button
                aria-label="Clear"
                className="text-[#6b7280] hover:text-[#111827]"
                onClick={() => setQ('')}
              >
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
                            sortBy === (o.k as any)
                              ? 'bg-[#f1f2f4] text-[#111827]'
                              : 'text-[#2e2e30]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            {sortBy === (o.k as any) ? (
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
        </div>
      </div>
    </div>
  );
}