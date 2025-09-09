/**
 * Modern bottom-center toaster (no loading variant, no progress bar).
 * - Variants: success | error | info
 * - Auto-dismiss
 * - Hover to pause timer
 * - Swipe/drag to dismiss
 * - Optional action button (e.g., Undo)
 * - Accessible (aria-live)
 *
 * Usage:
 *  - toastSuccess('Saved')
 *  - toastError('Failed')
 *  - toast('Custom', { type: 'info', duration: 5000, action: { label: 'Undo', onClick } })
 *  - <Toaster /> mounted once in App.tsx
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type ToastType = 'success' | 'error' | 'info';

type ToastOptions = {
  type?: ToastType;
  duration?: number;
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
  id?: number;
};

type ToastData = {
  id: number;
  message: string;
  type: ToastType;
  duration: number; // ms
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
  updatedAt: number; // forces timers to reset when the toast is updated
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4500,
  error: 6500,
  info: 4500,
};

const MAX_VISIBLE = 4;

const EVT_SHOW = 'app:toast:show';
const EVT_UPDATE = 'app:toast:update';
const EVT_DISMISS = 'app:toast:dismiss';
const EVT_COMPAT = 'app:toast'; // backward-compat simple show

/** Show a toast and return its id */
export function toast(message: string, opts: ToastOptions = {}): number {
  const id = opts.id ?? Date.now() + Math.floor(Math.random() * 1000);
  const payload = {
    id,
    message,
    type: opts.type ?? 'info',
    duration: opts.duration ?? DEFAULT_DURATION[opts.type ?? 'info'],
    action: opts.action,
    icon: opts.icon,
  };
  window.dispatchEvent(new CustomEvent(EVT_SHOW, { detail: payload }));
  return id;
}

/** Success toast helper */
export function toastSuccess(message: string, opts?: Omit<ToastOptions, 'type'>) {
  return toast(message, { ...opts, type: 'success' });
}

/** Error toast helper */
export function toastError(message: string, opts?: Omit<ToastOptions, 'type'>) {
  return toast(message, { ...opts, type: 'error' });
}

/** Update an existing toast */
export function toastUpdate(id: number, patch: Partial<Omit<ToastData, 'id' | 'updatedAt'>>) {
  window.dispatchEvent(new CustomEvent(EVT_UPDATE, { detail: { id, patch } }));
}

/** Dismiss a toast by id, or all if id is omitted */
export function toastDismiss(id?: number) {
  window.dispatchEvent(new CustomEvent(EVT_DISMISS, { detail: { id } }));
}

/** Toaster portal mounted once (bottom-center) */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const onCompat = (e: Event) => {
      const d = (e as CustomEvent<{ message: string; type?: ToastType }>).detail;
      toast(d.message, { type: d.type ?? 'info' });
    };
    const onShow = (e: Event) => {
      const d = (e as CustomEvent<Omit<ToastData, 'updatedAt'>>).detail;
      const next: ToastData = {
        id: d.id,
        message: d.message,
        type: d.type,
        duration: Math.max(800, d.duration),
        action: d.action,
        icon: d.icon,
        updatedAt: Date.now(),
      };
      setToasts((prev) => {
        const merged = [...prev, next];
        return merged.slice(Math.max(0, merged.length - MAX_VISIBLE));
      });
    };
    const onUpdate = (e: Event) => {
      const { id, patch } = (e as CustomEvent<{ id: number; patch: Partial<ToastData> }>).detail;
      setToasts((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                duration:
                  patch.duration !== undefined
                    ? Math.max(800, patch.duration)
                    : patch.type
                    ? DEFAULT_DURATION[patch.type]
                    : t.duration,
                updatedAt: Date.now(),
              }
            : t
        )
      );
    };
    const onDismiss = (e: Event) => {
      const { id } = (e as CustomEvent<{ id?: number }>).detail ?? {};
      setToasts((prev) => (id == null ? [] : prev.filter((t) => t.id !== id)));
    };

    window.addEventListener(EVT_COMPAT, onCompat as EventListener);
    window.addEventListener(EVT_SHOW, onShow as EventListener);
    window.addEventListener(EVT_UPDATE, onUpdate as EventListener);
    window.addEventListener(EVT_DISMISS, onDismiss as EventListener);
    return () => {
      window.removeEventListener(EVT_COMPAT, onCompat as EventListener);
      window.removeEventListener(EVT_SHOW, onShow as EventListener);
      window.removeEventListener(EVT_UPDATE, onUpdate as EventListener);
      window.removeEventListener(EVT_DISMISS, onDismiss as EventListener);
    };
  }, []);

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[1200] w-[min(92vw,420px)] -translate-x-1/2 sm:bottom-6"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }: { toast: ToastData; onClose: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);

  const startRef = useRef<number>(Date.now());
  const remainingRef = useRef<number>(toast.duration);
  const timerRef = useRef<number | null>(null);

  const Icon = useMemo(() => {
    if (toast.icon) return () => <>{toast.icon}</>;
    switch (toast.type) {
      case 'success':
        return () => <CheckCircleIcon className="h-5 w-5 text-emerald-600" />;
      case 'error':
        return () => <XCircleIcon className="h-5 w-5 text-red-600" />;
      case 'info':
      default:
        return () => <InformationCircleIcon className="h-5 w-5 text-slate-600" />;
    }
  }, [toast.icon, toast.type]);

  const accent =
    toast.type === 'success'
      ? 'bg-emerald-500'
      : toast.type === 'error'
      ? 'bg-red-500'
      : 'bg-indigo-500';

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    clearTimer();
    startRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onClose(toast.id), remainingRef.current);
  };

  useEffect(() => {
    remainingRef.current = toast.duration;
    startTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.updatedAt, toast.duration]);

  const onEnter = () => {
    setHovered(true);
    const elapsed = Date.now() - startRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  };

  const onLeave = () => {
    setHovered(false);
    startTimer();
  };

  const onActionClick = () => {
    try {
      toast.action?.onClick?.();
    } finally {
      onClose(toast.id);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.98 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      drag="y"
      dragElastic={0.18}
      dragConstraints={{ top: 0, bottom: 0 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 70) onClose(toast.id);
      }}
      className="pointer-events-auto mb-2 select-none overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-xl backdrop-blur-md ring-1 ring-black/5"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-start gap-3 px-3 py-2.5">
        <span className={`absolute left-0 top-0 h-full w-1 ${accent}`} />
        <div className="mt-0.5 shrink-0">
          <Icon />
        </div>

        <div className="min-w-0 flex-1 text-[13px] leading-5 text-slate-900">
          <div className="break-words">{toast.message}</div>

          {toast.action ? (
            <button
              type="button"
              onClick={onActionClick}
              className="mt-1 inline-flex items-center rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onClose(toast.id)}
          className="mt-0.5 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}