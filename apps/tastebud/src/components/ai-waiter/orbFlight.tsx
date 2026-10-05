// apps/tastebud/src/components/ai-waiter/orbFlight.tsx
// The waiter's orb travelling between the home screen and a sheet's dock — down when a sheet opens, back up when it
// closes. A copy of the orb is drawn above everything (sheets would clip it) and moves from one place to the other,
// re-measuring where it's going on every frame; the real orbs stay hidden while their copy is on its way. It lives
// on its own (not inside the sheet), so it can still fly after the sheet is gone.
import { createRoot } from 'react-dom/client';
import TenminOrb, { type OrbMode } from './TenminOrb';

export const ORB_BALL = 0.76; // the ball is this share of a TenminOrb's box
export const FLIGHT_MS = 350; // very fast — a quick swoop down into the dock

/** Where an orb's ball is: its centre and diameter, in viewport pixels. */
export type Ball = { cx: number; cy: number; d: number };

export const ballOf = (r: DOMRect, ballShare = 1): Ball => ({
  cx: r.left + r.width / 2,
  cy: r.top + r.height / 2,
  d: r.width * ballShare,
});

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

export type Flight = {
  /** stop it (nothing more happens, onLanded isn't called) */
  cancel: () => void;
  /** where the travelling orb is right now */
  now: () => Ball;
};

/** Fly an orb from `from` to wherever `to()` says (null = the place is gone → the flight just ends). */
export function flyOrb(opts: {
  from: Ball;
  to: () => Ball | null;
  mode: OrbMode;
  onLanded?: () => void;
}): Flight {
  const { from, to, mode, onLanded } = opts;
  const first = to();
  const bigD = Math.max(from.d, first?.d ?? from.d); // drawn at the bigger size, scaled down — always crisp
  const size = Math.round(bigD / ORB_BALL);
  const shrinking = !first || first.d <= from.d; // going down into the dock (shrinks early) or up home (grows late)

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${size}px`,
    height: `${size}px`,
    zIndex: '300', // above the sheets (z-100)
    pointerEvents: 'none',
    transformOrigin: '50% 50%',
    willChange: 'transform',
    filter: 'drop-shadow(0 14px 28px rgba(250, 40, 81, 0.25))',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<TenminOrb mode={mode} size={size} />);

  let cur: Ball = from;
  let raf = 0;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    // unmount after this frame (never during React's own render)
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  const place = (b: Ball) => {
    cur = b;
    host.style.transform = `translate(${b.cx - size / 2}px, ${b.cy - size / 2}px) scale(${b.d / bigD})`;
  };

  const t0 = performance.now();
  const frame = (nowMs: number) => {
    if (done) return;
    const t = Math.min(1, (nowMs - t0) / FLIGHT_MS);
    const dest = to();
    if (!dest) return end();
    const m = easeInOut(t); // eases out of where it was, glides, eases into place
    const s = shrinking ? easeOut(t) : easeIn(t); // shrinks early going down; grows late coming home
    place({
      cx: from.cx + (dest.cx - from.cx) * m,
      cy: from.cy + (dest.cy - from.cy) * m,
      d: from.d + (dest.d - from.d) * s,
    });
    if (t < 1) raf = requestAnimationFrame(frame);
    else {
      end();
      onLanded?.();
    }
  };
  place(from);
  raf = requestAnimationFrame(frame);

  return { cancel: end, now: () => cur };
}

/** "Here I am": the orb that just received a flight settles with a small bounce. */
export function settle(el: HTMLElement | null | undefined, baseTransform = '') {
  el?.animate?.(
    [
      { transform: `${baseTransform} scale(1.1)` },
      { transform: `${baseTransform} scale(0.97)`, offset: 0.6 },
      { transform: `${baseTransform} scale(1)` },
    ],
    { duration: 220, easing: 'ease-out' },
  );
}
