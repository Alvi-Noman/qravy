// apps/tastebud/src/components/SheetScroll.tsx
// Shared scrolling for bottom sheets (tray, suggestions, line editor, product sheet) — built for phones:
//   - the sheet is a column: header · scrolling body · footer — the footer never covers the list
//   - soft fades at the top/bottom edge when there's more to scroll, and a "More below" chip on long lists
//   - the page behind doesn't scroll (or rubber-band) while a sheet is open
//   - a field that gets focus (table, name, address, note) is scrolled clear of the keyboard
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ------------------------------------------------------------------ page scroll lock (nested sheets safe) */

let locks = 0;
let saved: { html: string; body: string } | null = null;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    if (locks++ === 0) {
      saved = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0 && saved) {
        document.documentElement.style.overflow = saved.html;
        document.body.style.overflow = saved.body;
        saved = null;
      }
    };
  }, [active]);
}

/* ------------------------------------------------------------------ edges: is there more above / below? */

function useScrollEdges(el: HTMLElement | null) {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const update = useCallback(() => {
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, [el]);
  useEffect(() => {
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    // content changes (a line added, a warning shown, pickup form opened) and resizes (keyboard, rotation)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [el, update]);
  return edges;
}

/* ------------------------------------------------------------------ the scrolling body */

type Props = {
  children: React.ReactNode;
  /** Classes for the scrolling element itself (padding etc.) */
  className?: string;
  /** Background the fades blend into */
  fadeFrom?: string;
  /** Show a "More below" chip when the list continues past the bottom edge */
  moreHint?: string;
};

/**
 * The scrolling middle of a sheet. Put it between a `shrink-0` header and a `shrink-0` footer inside a
 * `flex flex-col` sheet with a fixed height — it takes the space that's left and scrolls on its own.
 */
const SheetScrollArea = forwardRef<HTMLDivElement, Props>(function SheetScrollArea(
  { children, className = '', fadeFrom = '#F8F8F8', moreHint },
  ref
) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => inner.current as HTMLDivElement, [el]);
  const edges = useScrollEdges(el);

  // keyboard: keep the field being typed in visible above it
  useEffect(() => {
    if (!el) return;
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      window.setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    };
    el.addEventListener('focusin', onFocus);
    return () => el.removeEventListener('focusin', onFocus);
  }, [el]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={(node) => {
          inner.current = node;
          setEl(node);
        }}
        className={`h-full overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] ${className}`}
      >
        {children}
      </div>
      {/* fades: there's more above / below */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 h-5 transition-opacity duration-200 ${edges.top ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: `linear-gradient(to bottom, ${fadeFrom}, transparent)` }}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 transition-opacity duration-200 ${edges.bottom ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: `linear-gradient(to top, ${fadeFrom}, transparent)` }}
      />
      {moreHint && edges.bottom && !edges.top && (
        <button
          type="button"
          onClick={() => inner.current?.scrollBy({ top: Math.round((inner.current?.clientHeight ?? 300) * 0.7), behavior: 'smooth' })}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-[12px] font-medium text-gray-700 shadow-md ring-1 ring-gray-200 active:scale-95"
        >
          {moreHint} ↓
        </button>
      )}
    </div>
  );
});

export default SheetScrollArea;

/** Height for a bottom sheet on phones: the visible screen (dvh), never under the status bar. */
export const SHEET_HEIGHT = 'h-[85dvh] max-h-[calc(100dvh-env(safe-area-inset-top)-12px)]';

/** Locks the page behind while it's rendered — for sheets that return early when closed. */
export function ScrollLock(): null {
  useBodyScrollLock(true);
  return null;
}
