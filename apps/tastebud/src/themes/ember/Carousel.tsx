// apps/tastebud/src/themes/ember/Carousel.tsx
// The suggestion slider (2.3 / 2.4): one card at a time, card to card. A swipe moves exactly one card (it never
// flies past several) and settles with the card's left edge on the page margin, the next card peeking. The card in
// focus is full size; its neighbours sit a little smaller and dimmer, and follow the finger continuously as it moves.
// Quiet motion only: the cards ease in once (staggered), the dots morph, nothing bounces. A mouse can drag it too.
// Reduced-motion settings: no scaling, no fades — plain snapping.
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EM } from './ui';

const GAP = 16;
const EDGE = 28; // the page margin the focused card lines up with

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Carousel({
  children,
  focusIndex,
  focusKey,
  resetKey,
  label,
  onUserMove,
}: {
  children: ReactNode;
  /** a card to bring into focus (the dish Pixie is talking about) */
  focusIndex?: number | null;
  /** changes to slide to focusIndex again (the same card asked for twice) */
  focusKey?: string | number;
  /** the guest moved it themselves (finger, mouse, keys) — the page stops moving it for them */
  onUserMove?: () => void;
  /** changes when a new set of cards arrives → back to the first one */
  resetKey?: string;
  label: string;
}) {
  const cards = Children.toArray(children);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const raf = useRef(0);

  /** each card's distance from the focus position, in cards (0 = in focus) → its scale and brightness */
  const paint = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    const still = reducedMotion();
    let nearest = 0;
    let best = Infinity;
    items.forEach((item, i) => {
      const step = item.offsetWidth + GAP;
      const d = (item.offsetLeft - EDGE - el.scrollLeft) / step;
      if (Math.abs(d) < best) {
        best = Math.abs(d);
        nearest = i;
      }
      const inner = item.firstElementChild as HTMLElement | null;
      if (!inner) return;
      if (still) {
        inner.style.transform = '';
        inner.style.opacity = '';
        return;
      }
      const t = Math.min(1, Math.abs(d));
      // the focused card full size; the others slightly smaller and dimmer, leaning towards the focused one
      inner.style.transform = `scale(${1 - 0.07 * t})`;
      inner.style.transformOrigin = d > 0 ? 'left center' : 'right center';
      inner.style.opacity = String(1 - 0.38 * t);
    });
    if (nearest !== activeRef.current) {
      activeRef.current = nearest;
      setActive(nearest);
    }
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    paint();
    const ro = new ResizeObserver(paint);
    if (track.current) ro.observe(track.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [paint, cards.length]);

  const goTo = useCallback((i: number, smooth = true) => {
    const el = track.current;
    const item = el?.children[i] as HTMLElement | undefined;
    if (!el || !item) return;
    el.scrollTo({ left: item.offsetLeft - EDGE, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }, []);

  // new cards → start from the first one
  useEffect(() => {
    goTo(0, false);
    activeRef.current = 0;
    setActive(0);
    requestAnimationFrame(paint);
  }, [resetKey, goTo, paint]);

  // the dish Pixie is talking about comes into focus
  useEffect(() => {
    if (focusIndex != null && focusIndex >= 0) goTo(focusIndex);
  }, [focusIndex, focusKey, goTo]);

  /* a mouse can drag it (touch scrolls natively): snapping is paused while dragging, then it settles on one card */
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    onUserMove?.();
    if (e.pointerType !== 'mouse' || !track.current) return;
    drag.current = { x: e.clientX, left: track.current.scrollLeft, moved: false };
    track.current.style.scrollSnapType = 'none';
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    track.current.scrollLeft = d.left - dx;
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current) return;
    drag.current = null;
    const dx = e.clientX - d.x;
    // a flick moves one card in its direction; a small move settles back
    const next = Math.abs(dx) > 40 ? activeRef.current + (dx < 0 ? 1 : -1) : activeRef.current;
    const target = Math.max(0, Math.min(cards.length - 1, next));
    track.current.style.scrollSnapType = '';
    goTo(target);
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-3.5" role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={track}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          // a drag isn't a tap on the card under it
          if (drag.current?.moved) e.stopPropagation();
        }}
        onTouchStart={() => onUserMove?.()}
        onWheel={() => onUserMove?.()}
        onKeyDown={(e) => {
          onUserMove?.();
          if (e.key === 'ArrowRight') (e.preventDefault(), goTo(Math.min(cards.length - 1, activeRef.current + 1)));
          if (e.key === 'ArrowLeft') (e.preventDefault(), goTo(Math.max(0, activeRef.current - 1)));
        }}
        tabIndex={0}
        className="em-noscroll flex w-full items-center overflow-x-auto py-2 outline-none [-webkit-overflow-scrolling:touch]"
        style={{
          gap: GAP,
          paddingInline: EDGE,
          scrollPaddingInline: EDGE,
          scrollSnapType: 'x mandatory',
          overscrollBehaviorX: 'contain',
          cursor: 'grab',
        }}
      >
        {cards.map((card, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${cards.length}`}
            className="em-card-in shrink-0"
            // one card per swipe, its left edge on the margin; the cards ease in once, one after another
            style={{ scrollSnapAlign: 'start', scrollSnapStop: 'always', animationDelay: `${Math.min(i, 4) * 60}ms` }}
          >
            {/* scaled / dimmed by its distance from focus (paint) — follows the finger, no lag */}
            <div className="will-change-transform">
              {card}
            </div>
          </div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => (onUserMove?.(), goTo(i))}
              className="h-1.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: i === active ? 18 : 6, background: i === active ? EM.amber : '#3A3A3F' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
