import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  XMarkIcon,
  ChevronDownIcon,
  AtSymbolIcon,
  PaperClipIcon,
  PaperAirplaneIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { useTenant } from '../hooks/useTenant';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../context/AuthContext';
import { Link } from 'react-router-dom';

type Step = {
  id: string;
  label: string;
  description: string;
  cta: string;
  href?: string;
  done: boolean;
};

export default function AIAssistantPanel({
  open,
  onClose,
  onRequestOpen, // when provided, panel can ask parent to open itself
  width = 380,
}: {
  open: boolean;
  onClose?: () => void;
  onRequestOpen?: () => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const ALWAYS_DONE_ID = 'created-account';
  // Treat locations as server-driven (cannot be manually toggled)
  const SERVER_DRIVEN_IDS = new Set(['add-category', 'add-menu-item', 'add-locations']);

  // Server progress
  const { data: tenant, isFetching } = useTenant();
  const serverHasCategoryRaw = !!tenant?.onboardingProgress?.hasCategory;
  const serverHasMenuItemRaw = !!tenant?.onboardingProgress?.hasMenuItem;
  const serverHasLocationsRaw = !!tenant?.onboardingProgress?.hasLocations;

  // Whether to show "Add Locations" step (only when multiple locations selected in onboarding)
  const showLocationsStep = tenant?.restaurantInfo?.locationMode === 'multiple';

  // Query client + token (used to read caches)
  const queryClient = useQueryClient();
  const { token } = useAuthContext();

  // Helper: do we have any locations in cache right now?
  const hasLocationsFromCache = (() => {
    try {
      const locs = queryClient.getQueryData(['locations', token]) as unknown[] | undefined;
      return Array.isArray(locs) && locs.length > 0;
    } catch {
      return false;
    }
  })();

  // Sticky flags to avoid flicker while refetching
  const [hasCategory, setHasCategory] = useState<boolean>(serverHasCategoryRaw);
  const [hasMenuItem, setHasMenuItem] = useState<boolean>(serverHasMenuItemRaw);
  // Initialize locations from server OR cache so it renders as done immediately after creation
  const [hasLocations, setHasLocations] = useState<boolean>(serverHasLocationsRaw || hasLocationsFromCache);

  useEffect(() => {
    // Always allow upgrades to true; only downgrade when server explicitly says false and cache has none
    const cacheHasLocs = (() => {
      try {
        const locs = queryClient.getQueryData(['locations', token]) as unknown[] | undefined;
        return Array.isArray(locs) && locs.length > 0;
      } catch {
        return false;
      }
    })();

    if (isFetching) {
      if (serverHasCategoryRaw) setHasCategory(true);
      if (serverHasMenuItemRaw) setHasMenuItem(true);
      if (serverHasLocationsRaw || cacheHasLocs) setHasLocations(true);
    } else {
      // Adopt server truth but never downgrade below what cache proves
      setHasCategory(serverHasCategoryRaw);
      setHasMenuItem(serverHasMenuItemRaw);
      setHasLocations(serverHasLocationsRaw || cacheHasLocs);
    }
  }, [isFetching, serverHasCategoryRaw, serverHasMenuItemRaw, serverHasLocationsRaw, queryClient, token]);

  // Also listen to categories/menu-items/locations query caches for instant upgrade
  useEffect(() => {
    const updateFromCache = () => {
      try {
        const cats = queryClient.getQueryData(['categories', token]) as unknown[] | undefined;
        if (Array.isArray(cats) && cats.length > 0) setHasCategory(true);
      } catch {}
      try {
        const items = queryClient.getQueryData(['menu-items', token]) as unknown[] | undefined;
        if (Array.isArray(items) && items.length > 0) setHasMenuItem(true);
      } catch {}
      try {
        const locs = queryClient.getQueryData(['locations', token]) as unknown[] | undefined;
        if (Array.isArray(locs) && locs.length > 0) setHasLocations(true);
      } catch {}
    };

    updateFromCache();

    const unsub = queryClient.getQueryCache().subscribe((event) => {
      const q: any = (event as any)?.query;
      if (!q || !Array.isArray(q.queryKey)) return;
      const [key, kToken] = q.queryKey;
      if ((key === 'categories' || key === 'menu-items' || key === 'locations') && kToken === token) {
        updateFromCache();
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [queryClient, token]);

  // Build steps (conditionally include "Add Locations" above "Add Category")
  const FULL_STEPS: Step[] = [
    {
      id: 'created-account',
      label: 'Created Restaurant Account',
      description: 'Your Qravy account is set up. Next steps will help you publish your menu.',
      cta: 'Review Account',
      href: '/dashboard',
      done: true,
    },
    ...(showLocationsStep
      ? ([
          {
            id: 'add-locations',
            label: 'Add your locations',
            description: 'Add each location so you can assign menus and staff per location.',
            cta: 'Add Locations',
            href: '/locations',
            done: false,
          },
        ] as Step[])
      : []),
    {
      id: 'add-category',
      label: 'Add your first category',
      description: 'Create sections like Starters, Mains, and Desserts to organize your items.',
      cta: 'Add Category',
      href: '/categories',
      done: false,
    },
    {
      id: 'add-menu-item',
      label: 'Add your first product',
      description: 'Add a product with price, images, and optional variations and tags.',
      cta: 'Add Product',
      href: '/menu-items',
      done: false,
    },
    {
      id: 'design-menu',
      label: 'Design your Digital Menu',
      description: 'Customize colors, typography, and layout to match your brand identity.',
      cta: 'Open Designer',
      href: '/digital-menu',
      done: false,
    },
    {
      id: 'unlock-menu',
      label: 'Unlock your Digital Menu',
      description: 'Take your digital menu live so customers can browse it online.',
      cta: 'Go Live Settings',
      href: '/digital-menu',
      done: false,
    },
    {
      id: 'setup-access',
      label: 'Set Up Restaurant Access',
      description: 'Give your team access so they can manage your menu and orders from each location.',
      cta: 'Set Up Access',
      href: '/settings/Access',
      done: false,
    },
    {
      id: 'custom-domain',
      label: 'Customize your Domain',
      description: 'Connect a custom subdomain (e.g., menu.yourbrand.com) for your menu.',
      cta: 'Set Domain',
      href: '/digital-menu',
      done: false,
    },
  ];

  // Load locally-tracked steps, then merge server-driven flags
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const raw = localStorage.getItem('ai-setup-steps');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const doneMap = new Map<string, boolean>();
          for (const s of parsed) {
            if (s && typeof s.id === 'string') doneMap.set(s.id, !!s.done);
          }
          return FULL_STEPS.map((s) => {
            let done = s.done;
            if (s.id === ALWAYS_DONE_ID) done = true;
            else if (s.id === 'add-category') done = hasCategory;
            else if (s.id === 'add-menu-item') done = hasMenuItem;
            else if (s.id === 'add-locations') done = hasLocations;
            else done = doneMap.has(s.id) ? !!doneMap.get(s.id) : s.done;
            return { ...s, done };
          });
        }
      }
    } catch {}
    return FULL_STEPS.map((s) => (s.id === ALWAYS_DONE_ID ? { ...s, done: true } : s));
  });

  // Re-sync steps whenever server flags or visibility of locations step changes
  useEffect(() => {
    setSteps(() => {
      // Read local completion for non-server-driven steps
      const doneMap = new Map<string, boolean>();
      try {
        const raw = localStorage.getItem('ai-setup-steps');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const s of parsed) {
              if (s && typeof s.id === 'string') doneMap.set(s.id, !!s.done);
            }
          }
        }
      } catch {}
      return FULL_STEPS.map((s) => {
        if (s.id === ALWAYS_DONE_ID) return { ...s, done: true };
        if (s.id === 'add-category') return { ...s, done: hasCategory };
        if (s.id === 'add-menu-item') return { ...s, done: hasMenuItem };
        if (s.id === 'add-locations') return { ...s, done: hasLocations };
        return { ...s, done: doneMap.has(s.id) ? !!doneMap.get(s.id) : s.done };
      });
    });
  }, [showLocationsStep, hasCategory, hasMenuItem, hasLocations]);

  // Expanded management
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastAutoExpandedId, setLastAutoExpandedId] = useState<string | null>(null);

  const firstIncompleteId = steps.find((s) => !s.done)?.id ?? null;

  useEffect(() => {
    if (firstIncompleteId && firstIncompleteId !== lastAutoExpandedId) {
      setExpandedId(firstIncompleteId);
      setLastAutoExpandedId(firstIncompleteId);
    }
  }, [firstIncompleteId, lastAutoExpandedId]);

  const allDone = steps.length > 0 && steps.every((s) => s.done);

  // Delay auto-open by 1.5s after mount, then allow auto-open while closed when steps are incomplete
  const [autoOpenReady, setAutoOpenReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAutoOpenReady(true), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const anyIncomplete = steps.some((s) => !s.done);
    if (autoOpenReady && !open && anyIncomplete) {
      onRequestOpen?.();
    }
  }, [open, steps, onRequestOpen, autoOpenReady]);

  // Auto-close when all steps become done while the panel is open
  const prevAllDoneRef = useRef<boolean>(allDone);
  useEffect(() => {
    if (!open) {
      prevAllDoneRef.current = allDone;
      return;
    }
    if (allDone && !prevAllDoneRef.current) {
      const t = setTimeout(() => onClose?.(), 200);
      return () => clearTimeout(t);
    }
    prevAllDoneRef.current = allDone;
  }, [allDone, open, onClose]);

  // Persist only id/done pairs (server-driven steps persist server/cached truth)
  useEffect(() => {
    const compact = steps.map((s) => ({
      id: s.id,
      done:
        s.id === ALWAYS_DONE_ID
          ? true
          : s.id === 'add-category'
          ? hasCategory
          : s.id === 'add-menu-item'
          ? hasMenuItem
          : s.id === 'add-locations'
          ? hasLocations
          : s.done,
    }));
    localStorage.setItem('ai-setup-steps', JSON.stringify(compact));
  }, [steps, hasCategory, hasMenuItem, hasLocations]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const toggleDone = (id: string) => {
    if (id === ALWAYS_DONE_ID) return;
    if (SERVER_DRIVEN_IDS.has(id)) return; // prevent manual toggle for server-driven steps (includes locations)
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  };

  const toggleExpand = (id: string) => {
    setExpandedId((curr) => (curr === id ? null : id));
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="ai-panel"
          ref={ref}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative flex h-full flex-col border-l border-[#ececec] bg-[#fcfcfc]/95 backdrop-blur"
          style={{ width }}
          aria-label="AI Assistant"
        >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ececec] bg-[#fcfcfc]/95 px-3 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-800 font-medium">
              {allDone ? 'New conversation' : 'Setup Guide'}
              <ChevronDownIcon className="h-4 w-4 text-slate-500" />
            </span>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="rounded-md p-1.5 hover:bg-[#f6f6f6]"
            >
              <XMarkIcon className="h-5 w-5 text-slate-700" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {!allDone ? (
              <ul className="space-y-3">
                {steps.map((step) => {
                  const isExpanded = expandedId === step.id;
                  const isDone = step.done;
                  const isAlwaysDone = step.id === ALWAYS_DONE_ID;
                  const isServerDriven = SERVER_DRIVEN_IDS.has(step.id);

                  // Build CTA target; add query param for specific steps to auto-open dialogs
                  const href =
                    step.id === 'add-category' && step.href
                      ? `${step.href}?new=category`
                      : step.id === 'add-menu-item' && step.href
                      ? `${step.href}?new=product`
                      : step.id === 'add-locations' && step.href
                      ? `${step.href}?new=location`
                      : step.href;

                  return (
                    <li
                      key={step.id}
                      className={`rounded-lg border transition-colors ${
                        isDone ? 'bg-emerald-50/70 border-emerald-200' : 'bg-white border-[#ececec]'
                      }`}
                    >
                      {/* Step header row */}
                      <div className="flex items-start gap-3 p-3">
                        {/* Check control */}
                        <button
                          type="button"
                          onClick={() => toggleDone(step.id)}
                          aria-pressed={isDone}
                          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                          disabled={isAlwaysDone || isServerDriven}
                          className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                            isDone
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 border-dotted text-transparent'
                          } ${isAlwaysDone || isServerDriven ? 'cursor-default pointer-events-none' : ''}`}
                          title={
                            isAlwaysDone
                              ? 'Completed'
                              : isServerDriven
                              ? 'Auto-completed from your data'
                              : isDone
                              ? 'Mark incomplete'
                              : 'Mark complete'
                          }
                        >
                          {isDone ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                        </button>

                        {/* Title area */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(step.id)}
                          aria-expanded={isExpanded}
                          className="flex-1 text-left"
                        >
                          <div className={`text-sm font-medium ${isDone ? 'line-through text-slate-500' : 'text-[#2e2e30]'}`}>
                            {step.label}
                          </div>
                        </button>
                      </div>

                      {/* Details + CTA */}
                      <AnimatePresence initial={false} mode="wait">
                        {isExpanded && (
                          <motion.div
                            key={`details-${step.id}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="px-3 pb-3"
                          >
                            <p className="text-[12px] text-slate-600">{step.description}</p>
                            <div className="mt-3">
                              {href ? (
                                step.id === 'add-category' ||
                                step.id === 'add-menu-item' ||
                                step.id === 'add-locations' ? (
                                  <Link
                                    to={href}
                                    className={`inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium ${
                                      isDone ? 'text-slate-400 cursor-default pointer-events-none' : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {step.cta}
                                  </Link>
                                ) : (
                                  <a
                                    href={href}
                                    className={`inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium ${
                                      isDone ? 'text-slate-400 cursor-default pointer-events-none' : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {step.cta}
                                  </a>
                                )
                              ) : (
                                <button
                                  type="button"
                                  disabled={isDone}
                                  className={`inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium ${
                                    isDone ? 'text-slate-400 cursor-default' : 'text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {step.cta}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-8 flex flex-col items-center text-center">
                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white">
                  AI
                </div>
                <div className="text-base font-semibold text-slate-900">Hey there</div>
                <div className="mt-1 text-[13px] text-slate-600">How can I help?</div>
              </div>
            )}
          </div>

          {/* Composer (only after setup complete) */}
          {allDone && (
            <div className="border-t border-[#ececec] p-3 bg-[#fcfcfc]/95">
              <div className="rounded-xl bg-white p-2 shadow">
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 px-1 pb-1 text-slate-500">
                    <AtSymbolIcon className="h-5 w-5" />
                    <PaperClipIcon className="h-5 w-5" />
                  </div>
                  <textarea
                    rows={1}
                    placeholder="Ask anything…"
                    className="min-h-[36px] w-full resize-none bg-transparent px-2 text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                    title="Send"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}