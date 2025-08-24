import { useEffect, useMemo, useRef, useState, type SVGProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '../context/ScopeContext';
import { ChevronDownIcon, PlusIcon, BellIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import TopbarProfileMenu from './TopbarProfileMenu';
import TopbarSearch from './TopbarSearch';

const BranchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <path stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" d="M6 5.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zM6 15.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zM18 5.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z" />
    <path stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" d="M6 8.75v4.5a3 3 0 003 3H12m0 0h2.5a3 3 0 003-3V8.75" />
  </svg>
);

const CHANNEL_TABS = ['All channels', 'Dine-In', 'Online'] as const;
const tabToScope = (t: typeof CHANNEL_TABS[number]) => (t === 'All channels' ? 'all' : t === 'Dine-In' ? 'dine-in' : 'online');

type NotificationItem = { id: string; title: string; desc: string; time: string; seen: boolean };

const DUMMY_NOTIFICATIONS: NotificationItem[] = [
  { id: '1', title: 'New order #1042', desc: 'Table 5 placed an order', time: '2m', seen: false },
  { id: '2', title: 'Low stock: Fries', desc: 'Only 8 portions left', time: '14m', seen: false },
  { id: '3', title: 'Menu updated', desc: 'Spicy Ramen price changed', time: '1h', seen: true },
  { id: '4', title: 'Payout processed', desc: 'Yesterday’s payout is on the way', time: '3h', seen: true },
  { id: '5', title: 'New review', desc: '4.5★ from a diner', time: '1d', seen: true },
];

export default function TopBar(): JSX.Element {
  const { branch, setBranch, channel, setChannel } = useScope();
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'seen' | 'unseen'>('all');

  const branchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const branchLabel = useMemo(() => {
    if (branch.mode === 'all') return 'All Branches';
    if (branch.branches.length === 1) return branch.branches[0];
    return `${branch.branches.length} branches`;
  }, [branch]);

  const activeChannelIdx = useMemo(() => (channel === 'all' ? 0 : channel === 'dine-in' ? 1 : 2), [channel]);

  const filteredAll = useMemo(
    () => ['Branch 1', 'Branch 2'].filter((b) => b.toLowerCase().includes(branchQuery.toLowerCase())),
    [branchQuery]
  );

  useEffect(() => {
    if (!(branchOpen || notifOpen)) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (branchOpen && branchRef.current && !branchRef.current.contains(t)) setBranchOpen(false);
      if (notifOpen && notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBranchOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [branchOpen, notifOpen]);

  return (
    <div className="sticky top-0 z-10 border-b border-[#ececec] bg-[#fcfcfc]/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Branch */}
        <div className="relative flex items-center gap-2" ref={branchRef}>
          <button
            type="button"
            aria-label="Branch"
            aria-expanded={branchOpen}
            onClick={() => setBranchOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100"
          >
            <BranchIcon className="h-4 w-4 text-slate-600" />
            {branchLabel}
            <ChevronDownIcon className="h-4 w-4 text-slate-500" />
          </button>

          <AnimatePresence>
            {branchOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
              >
                <div className="p-2">
                  <input
                    value={branchQuery}
                    onChange={(e) => setBranchQuery(e.target.value)}
                    placeholder="Search branches…"
                    className="w-full rounded-md border border-[#ececec] bg-white px-3 py-2 text-[13px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </div>
                <ul role="menu" className="max-h-72 overflow-y-auto py-1">
                  {['All Branches', ...filteredAll].map((opt) => {
                    const selected =
                      opt === 'All Branches'
                        ? branch.mode === 'all'
                        : branch.mode === 'specific' && branch.branches.includes(opt);
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            if (opt === 'All Branches') setBranch({ mode: 'all' });
                            else setBranch({ mode: 'specific', branches: [opt] });
                            setBranchOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ${
                            selected ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <BranchIcon className="h-4 w-4 text-slate-500" />
                            {opt}
                          </span>
                          {selected ? <span className="text-[11px] text-slate-500">Selected</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-slate-200 bg-slate-50 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setBranchOpen(false);
                      navigate('/branches?new=1');
                    }}
                    className="w-full inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100"
                  >
                    <PlusIcon className="h-4 w-4 text-slate-600" />
                    Add branch
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Separator — dash */}
        <span aria-hidden className="hidden select-none text-slate-300 md:inline">—</span>

        {/* Channel */}
        <div className="hidden md:flex items-center gap-2">
          <div role="tablist" aria-label="Channel" className="relative grid h-9 grid-cols-3 overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-1">
            <div
              className="pointer-events-none absolute left-1 top-1 bottom-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-200"
              style={{ transform: `translateX(${activeChannelIdx * 100}%)` }}
            />
            {CHANNEL_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tabToScope(t) === channel}
                title={t === 'Online' ? 'Pickup, Delivery' : undefined}
                onClick={() => setChannel(tabToScope(t))}
                className={`relative z-10 flex items-center justify-center rounded-full px-3 text-[13px] font-medium transition-colors ${
                  tabToScope(t) === channel ? 'text-slate-900' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Search (separated) */}
        <TopbarSearch className="ml-2 flex-1" />

        {/* Notifications */}
        <TopbarNotifications
          notifOpen={notifOpen}
          setNotifOpen={setNotifOpen}
          notifFilter={notifFilter}
          setNotifFilter={setNotifFilter}
          notifRef={notifRef}
          items={DUMMY_NOTIFICATIONS.filter((n) =>
            notifFilter === 'all' ? true : notifFilter === 'seen' ? n.seen : !n.seen
          )}
        />

        {/* Profile */}
        <div className="ml-2 shrink-0">
          <TopbarProfileMenu />
        </div>
      </div>
    </div>
  );
}

function TopbarNotifications({
  notifOpen,
  setNotifOpen,
  notifFilter,
  setNotifFilter,
  notifRef,
  items,
}: {
  notifOpen: boolean;
  setNotifOpen: (v: boolean) => void;
  notifFilter: 'all' | 'seen' | 'unseen';
  setNotifFilter: (f: 'all' | 'seen' | 'unseen') => void;
  notifRef: React.RefObject<HTMLDivElement>;
  items: NotificationItem[];
}) {
  return (
    <div className="relative ml-2 shrink-0" ref={notifRef}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={notifOpen}
        onClick={() => setNotifOpen(!notifOpen)}
        className="relative rounded-md p-2 text-slate-700 hover:bg-slate-100"
      >
        <BellIcon className="h-5 w-5 text-slate-600" />
        {items.some((n) => !n.seen) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-indigo-600" />}
      </button>

      <AnimatePresence>
        {notifOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            <div className="p-2">
              <div className="relative grid h-8 grid-cols-3 overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-1">
                {(['all', 'seen', 'unseen'] as const).map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={notifFilter === f}
                    onClick={() => setNotifFilter(f)}
                    className={`relative z-10 rounded-full text-[12px] font-medium ${
                      notifFilter === f ? 'text-slate-900' : 'text-slate-600 hover:text-slate-800'
                    }`}
                    style={{ width: '33.333%' }}
                  >
                    {f === 'all' ? 'All' : f === 'seen' ? 'Seen' : 'Unseen'}
                  </button>
                ))}
                <div
                  className="pointer-events-none absolute left-1 top-1 bottom-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-200"
                  style={{
                    transform: `translateX(${['all', 'seen', 'unseen'].indexOf(notifFilter) * 100}%)`,
                  }}
                />
              </div>
            </div>

            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {items.length ? (
                items.map((n) => (
                  <li key={n.id} className="px-3 py-2 hover:bg-slate-50">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className={`text-[13px] ${n.seen ? 'text-slate-800' : 'font-semibold text-slate-900'}`}>{n.title}</div>
                        <div className="truncate text-[12px] text-slate-600">{n.desc}</div>
                      </div>
                      <div className="ml-2 shrink-0 text-[11px] text-slate-400">{n.time}</div>
                    </div>
                    {!n.seen ? (
                      <span className="mt-1 inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                        New
                      </span>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="px-3 py-6 text-center text-[13px] text-slate-500">No notifications</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}