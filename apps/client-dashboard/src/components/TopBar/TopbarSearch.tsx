import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MagnifyingGlassIcon,
  ClockIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { useScope } from '../../context/ScopeContext';

/** Supported scopes for quick filters in the search popover. */
type SearchScope = 'products' | 'orders' | 'customers' | 'settings';

/** Shopify-like topbar search with realtime debounce, non-persistent text, recent history, and a thin clear button while typing. */
export default function TopbarSearch({ className = '' }: { className?: string }) {
  const { setSearchQuery } = useScope();

  /** Whether popover is open. */
  const [open, setOpen] = useState(false);
  /** Current input value; always reset when opening/closing. */
  const [draft, setDraft] = useState('');
  /** Active search scope chip. */
  const [scope, setScope] = useState<SearchScope | null>(null);

  /** Loading state while simulated fetch is in progress. */
  const [loading, setLoading] = useState(false);
  /** Whether simulated results are ready; shows "No results found" for now. */
  const [resultsReady, setResultsReady] = useState(false);

  /** Root ref to detect outside clicks. */
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Input ref to focus programmatically. */
  const inputRef = useRef<HTMLInputElement>(null);
  /** Last saved term guard to avoid duplicate entries while pausing on the same query. */
  const lastSavedRef = useRef<string>('');

  const navigate = useNavigate();
  const location = useLocation();

  /** Recent searches loaded from localStorage. */
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('qravy_recent_searches');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  /** Saves a term to localStorage-backed recent history (deduped, capped). */
  const saveRecent = (q: string) => {
    const t = q.trim();
    if (!t || lastSavedRef.current === t) return;
    setRecent((prev) => {
      const next = [t, ...prev.filter((r) => r !== t)].slice(0, 8);
      try {
        localStorage.setItem('qravy_recent_searches', JSON.stringify(next));
      } catch {}
      lastSavedRef.current = t;
      return next;
    });
  };

  /** Closes on outside click or Escape; clears input and loading states. */
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft('');
        setLoading(false);
        setResultsReady(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setDraft('');
        setLoading(false);
        setResultsReady(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  /** Opens with ⌘/Ctrl + K, fresh and focused. */
  useEffect(() => {
    const onHotkey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const editing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if (!editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDraft('');
        setLoading(false);
        setResultsReady(false);
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onHotkey);
    return () => document.removeEventListener('keydown', onHotkey);
  }, []);

  /** Debounced realtime "search": shows empty card while typing, spinner in input while fetching, then "No results found". */
  useEffect(() => {
    if (!open) return;
    setResultsReady(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      setLoading(false);
      return;
    }
    const debounceMs = 500;
    const loaderMs = 600;
    let debounceTimer: number | undefined;
    let loaderTimer: number | undefined;
    debounceTimer = window.setTimeout(() => {
      setLoading(true);
      loaderTimer = window.setTimeout(() => {
        setLoading(false);
        setResultsReady(true);
        saveRecent(trimmed);
      }, loaderMs);
    }, debounceMs);
    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      if (loaderTimer) window.clearTimeout(loaderTimer);
    };
  }, [draft, open]);

  /** Navigates with current scope and term; also persists to recent, then resets state. */
  const submit = (q: string) => {
    const trimmed = q.trim();
    const params = new URLSearchParams(location.search);
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    if (scope) params.set('scope', scope);
    else params.delete('scope');
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    if (trimmed) saveRecent(trimmed);
    setSearchQuery('');
    setOpen(false);
    setDraft('');
    setLoading(false);
    setResultsReady(false);
  };

  /** Clears recent history. */
  const clearHistory = () => {
    setRecent([]);
    lastSavedRef.current = '';
    try {
      localStorage.removeItem('qravy_recent_searches');
    } catch {}
  };

  /** Pretty label for a given scope. */
  const scopeLabel = (s: SearchScope | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

  /** Whether there is any non-whitespace draft in the input. */
  const hasDraft = draft.trim().length > 0;

  /** Standardized result area to keep heights consistent across states. */
  const resultAreaClass = 'flex flex-col items-center justify-center px-6 py-14 min-h-[240px]';

  return (
    <div ref={wrapRef} className={`relative flex min-w-0 ${className}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex min-w-0 flex-1 items-center rounded-lg border border-[#dbdbdb] hover:border-[#111827] focus-within:border-[#111827] transition-colors bg-[#fcfcfc] px-3 py-1.5"
        onClick={() => {
          setDraft('');
          setLoading(false);
          setResultsReady(false);
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        {loading ? (
          <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin text-slate-500" />
        ) : (
          <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-slate-500" />
        )}

        {open && scope && (
          <span className="mr-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-700">
            {scopeLabel(scope)}
            <button
              type="button"
              aria-label="Clear scope"
              onClick={(e) => {
                e.stopPropagation();
                setScope(null);
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 hover:bg-slate-200"
            >
              <XMarkIcon className="h-3.5 w-3.5 text-slate-500" />
            </button>
          </span>
        )}

        <input
          ref={inputRef}
          value={open ? draft : ''}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-[#2e2e30] placeholder-[#a9a9ab] focus:outline-none focus:ring-0"
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !draft && scope) setScope(null);
          }}
        />

        {hasDraft ? (
          /** Thin clear button (no circle) to avoid changing input height. */
          <button
            type="button"
            aria-label="Clear search"
            onClick={(e) => {
              e.stopPropagation();
              setDraft('');
              setLoading(false);
              setResultsReady(false);
              inputRef.current?.focus();
            }}
            className="ml-2 p-0 text-slate-500 hover:text-slate-700 leading-none"
            style={{ lineHeight: 0 }}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        ) : (
          <div className="ml-2 hidden items-center gap-1 text-[11px] text-slate-400 md:flex">
            <span className="rounded border border-slate-300 bg-slate-50 px-1">⌘</span>
            <span>+</span>
            <span className="rounded border border-slate-300 bg-slate-50 px-1">K</span>
          </div>
        )}
      </form>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {!hasDraft && !scope && (
              <div className="p-2">
                <div className="flex flex-wrap gap-2">
                  {(['products', 'orders', 'customers', 'settings'] as SearchScope[]).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setScope(tag);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-200"
                    >
                      {scopeLabel(tag)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasDraft && !loading && !resultsReady ? (
              <div className={resultAreaClass} />
            ) : hasDraft && loading ? (
              <div className={resultAreaClass} />
            ) : hasDraft && resultsReady ? (
              <div className={resultAreaClass}>
                <MagnifyingGlassIcon className="h-10 w-10 text-slate-300" />
                <div className="mt-3 text-[13px] text-slate-600">
                  No results found{scope ? ` in ${scopeLabel(scope).toLowerCase()}` : ''}
                </div>
              </div>
            ) : scope ? (
              <div className={resultAreaClass}>
                <MagnifyingGlassIcon className="h-10 w-10 text-slate-300" />
                <div className="mt-3 text-[13px] text-slate-600">
                  Search for {scopeLabel(scope).toLowerCase()}
                </div>
              </div>
            ) : (
              <>
                <div className={resultAreaClass}>
                  <MagnifyingGlassIcon className="h-10 w-10 text-slate-300" />
                  <div className="mt-3 text-[13px] text-slate-600">Search for anything</div>
                </div>

                {recent.length ? (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div className="text-[12px] font-medium text-slate-600">Recent searches</div>
                      <button
                        type="button"
                        onClick={clearHistory}
                        className="text-[12px] font-medium text-indigo-600 hover:underline"
                      >
                        Clear history
                      </button>
                    </div>
                    <ul className="max-h-64 overflow-y-auto">
                      {recent.map((q) => (
                        <li key={q}>
                          <button
                            type="button"
                            onClick={() => {
                              setDraft(q);
                              setLoading(true);
                              setResultsReady(false);
                              setTimeout(() => {
                                setLoading(false);
                                setResultsReady(true);
                                saveRecent(q);
                              }, 600);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                          >
                            <ClockIcon className="h-4 w-4 text-slate-400" />
                            <span className="truncate text-[13px] text-slate-700">{q}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}