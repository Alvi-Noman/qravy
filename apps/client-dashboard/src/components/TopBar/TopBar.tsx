/**
 * TopBar with a thin animated loader at the bottom edge.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BellIcon, SparklesIcon } from '@heroicons/react/24/outline';
import TopbarSearch from './TopbarSearch.js';
import TopbarProfileMenu from './TopbarProfileMenu.js';
import { useProgress } from '../../context/ProgressContext';

type NotificationItem = { id: string; title: string; desc: string; time: string; seen: boolean };

const DUMMY_NOTIFICATIONS: NotificationItem[] = [
  { id: '1', title: 'New order #1042', desc: 'Table 5 placed an order', time: '2m', seen: false },
  { id: '2', title: 'Low stock: Fries', desc: 'Only 8 portions left', time: '14m', seen: false },
  { id: '3', title: 'Menu updated', desc: 'Spicy Ramen price changed', time: '1h', seen: true },
  { id: '4', title: 'Payout processed', desc: 'Yesterday’s payout is on the way', time: '3h', seen: true },
  { id: '5', title: 'New review', desc: '4.5★ from a diner', time: '1d', seen: true },
];

export default function TopBar({ onAIClick }: { onAIClick?: () => void }): JSX.Element {
  const { active } = useProgress();

  const [isLive, setIsLive] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'seen' | 'unseen'>('all');
  const notifRef = useRef<HTMLDivElement>(null);

  const filteredNotifications = useMemo(
    () =>
      DUMMY_NOTIFICATIONS.filter((n) =>
        notifFilter === 'all' ? true : notifFilter === 'seen' ? n.seen : !n.seen
      ),
    [notifFilter]
  );

  useEffect(() => {
    if (!notifOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setNotifOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [notifOpen]);

  return (
    <div className="sticky top-0 z-30 border-b border-[#ececec] bg-[#fcfcfc]/95 backdrop-blur">
      <div className="relative">
        <div className="flex items-center gap-3 px-4 py-2">
          <DigitalMenuStatus
            isLive={isLive}
            onChange={(next) => setIsLive(next)}
            scopeLabel="Main Branch"
            viewMenuHref="/menu"
          />

          <TopbarSearch className="ml-auto mr-2 w-[28rem] md:w-[40rem]" />

          <button
            type="button"
            aria-label="AI Assistant"
            onClick={() => onAIClick?.()}
            className="rounded-md p-2 text-slate-700 hover:bg-[#f6f6f6]"
            title="AI Assistant"
          >
            <SparklesIcon className="h-5 w-5 text-slate-600" />
          </button>

          <TopbarNotifications
            items={filteredNotifications}
            notifOpen={notifOpen}
            setNotifOpen={setNotifOpen}
            notifFilter={notifFilter}
            setNotifFilter={setNotifFilter}
            notifRef={notifRef}
          />

          <div className="ml-2 shrink-0">
            <TopbarProfileMenu />
          </div>
        </div>

        <TopbarProgress active={active} />
      </div>
    </div>
  );
}

/* Digital Menu status (read-only pill + popover to change with confirmation) */
function DigitalMenuStatus({
  isLive: isLiveProp,
  onChange,
  scopeLabel,
  viewMenuHref,
}: {
  isLive: boolean;
  onChange?: (next: boolean) => void;
  scopeLabel?: string;
  viewMenuHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isLive, setIsLive] = useState(isLiveProp);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'confirm-offline'>('idle');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setIsLive(isLiveProp), [isLiveProp]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPhase('idle');
        setError(null);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), setPhase('idle'), setError(null));
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const applyChange = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange?.(next);
      setIsLive(next);
      setOpen(false);
      setPhase('idle');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Manage digital menu visibility"
        className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-[#f6f6f6]"
      >
        <span className="font-medium">Digital Menu</span>
        <span className="text-slate-400">•</span>
        <span className="inline-flex items-center">
          <span className="font-medium">{isLive ? 'Live' : 'Offline'}</span>
          <StatusHalo color={isLive ? 'green' : 'red'} />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            role="dialog"
            aria-label="Digital menu status"
            className="absolute left-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            <div className="p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-medium text-slate-900">Online visibility</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {scopeLabel ? <span>Scope: {scopeLabel}</span> : <span>Global</span>}
                  </div>
                </div>
                {viewMenuHref ? (
                  <a
                    href={viewMenuHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md px-2 py-1 text-[12px] text-slate-700 hover:underline"
                  >
                    View menu
                  </a>
                ) : null}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-[13px]">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <span>{isLive ? 'Live' : 'Offline'}</span>
                    <StatusHalo color={isLive ? 'green' : 'red'} />
                  </div>
                  <div className="text-[12px] text-slate-500">
                    {isLive ? 'Visible to customers' : 'Hidden from customers'}
                  </div>
                </div>

                {isLive ? (
                  <button
                    type="button"
                    onClick={() => setPhase('confirm-offline')}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700"
                  >
                    Take offline
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => applyChange(true)}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    {busy ? 'Going live…' : 'Go live'}
                  </button>
                )}
              </div>

              <AnimatePresence initial={false} mode="wait">
                {phase === 'confirm-offline' && (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="mt-3 rounded-md border border-red-200 bg-red-50 p-3"
                  >
                    <div className="text-[13px] font-medium text-red-900">Take menu offline?</div>
                    <p className="mt-1 text-[12px] text-red-800">
                      Customers won’t be able to view your menu until you turn it back on.
                    </p>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPhase('idle')}
                        className="rounded-md px-2.5 py-1.5 text-[12px] text-red-900 hover:bg-[#f6f6f6]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => applyChange(false)}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {busy ? 'Taking offline…' : 'Confirm'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && <div className="mt-2 text-[12px] text-red-600">{error}</div>}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1.5 text-[12px] text-slate-700 hover:bg-[#f6f6f6]"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Halo dot after label (green/red) */
function StatusHalo({ color = 'green' as 'green' | 'red' }) {
  const outer = color === 'green' ? 'bg-emerald-400/25' : 'bg-red-400/25';
  const inner = color === 'green' ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <span aria-hidden className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full relative">
      <span className={`absolute h-4 w-4 rounded-full ${outer}`} />
      <span className={`relative h-2.5 w-2.5 rounded-full ${inner}`} />
    </span>
  );
}

/* Notifications (button + popover) with green badge */
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
    <div className="relative ml-0 shrink-0" ref={notifRef}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={notifOpen}
        onClick={() => setNotifOpen(!notifOpen)}
        className="relative rounded-md p-2 text-slate-700 hover:bg-[#f6f6f6]"
      >
        <BellIcon className="h-5 w-5 text-slate-600" />
        {items.some((n) => !n.seen) && (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500" />
        )}
      </button>

      <AnimatePresence>
        {notifOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-[#ececec] bg-white shadow-lg"
          >
            <div className="p-2">
              <div className="relative grid h-8 grid-cols-3 overflow-hidden rounded-full border border-[#e5e5e5] bg-[#f5f5f5] p-1">
                {(['all', 'seen', 'unseen'] as const).map((f) => (
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
                  <li key={n.id} className="px-3 py-2 hover:bg-[#f6f6f6]">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className={`text-[13px] ${n.seen ? 'text-slate-800' : 'font-semibold text-slate-900'}`}>
                          {n.title}
                        </div>
                        <div className="truncate text-[12px] text-slate-600">{n.desc}</div>
                      </div>
                      <div className="ml-2 shrink-0 text-[11px] text-slate-400">{n.time}</div>
                    </div>
                    {!n.seen ? (
                      <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
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

/** Thin animated progress line at the bottom border of the topbar */
function TopbarProgress({ active }: { active: boolean }) {
  return (
    <div className="absolute left-0 right-0 bottom-0 h-[2px]">
      <div
        className="relative h-full overflow-hidden"
        style={{ opacity: active ? 1 : 0, transition: 'opacity 120ms ease' }}
        aria-hidden={!active}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.9) 50%, rgba(99,102,241,0) 100%)',
            backgroundSize: '200% 100%',
            animation: 'topbar-progress-move 1.1s linear infinite',
          }}
        />
      </div>
      <style>
        {`
          @keyframes topbar-progress-move {
            0% { background-position: 0% 0; }
            100% { background-position: 200% 0; }
          }
        `}
      </style>
    </div>
  );
}