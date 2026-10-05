// apps/tastebud/src/components/ai-waiter/AssistantDock.tsx
// The waiter's presence at the bottom of a popup (the cards, the tray): a soft pink panel rises from the bottom
// edge, and the home screen's orb travels down into it — shrinking as it goes — to settle on its top edge. What the
// waiter says plays as subtitles inside (scroll them to read back). HOLD the orb to talk.
import React from 'react';
import { createPortal } from 'react-dom';
import TenminOrb from './TenminOrb';
import ScrollText from './ScrollText';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ChooseOption } from '../../utils/handsfree';

type OrbMode = 'idle' | 'listening' | 'thinking' | 'talking';

type Props = {
  mode: OrbMode;
  /** "Listening…" / "Thinking…" — shown when there's nothing to subtitle */
  status: string;
  /** what the waiter is saying (grows word by word while it speaks) */
  subtitle?: string;
  /** press handlers that make the orb the mic (hold to talk) */
  orbProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  /** the home screen's orb (the ball) — this orb starts there, at its size, and travels into the dock */
  originRef?: React.RefObject<HTMLElement | null>;
  choices?: ChooseOption[];
  onChoose?: (say: string) => void;
  /** opened by a tap, nothing said yet: no subtitle box — a short panel with the orb lower; it grows (the orb
   *  rises) as soon as the guest speaks or the waiter answers */
  compact?: boolean;
};

// the ball is ~76% of this (~88 px, ~70 px on phones); the rest is room for the ring and waves
const ORB_DESKTOP = 116;
const ORB_MOBILE = 92;
const BALL = 0.76;

const FLIGHT_MS = 1100; // the home orb's trip down into the dock — slow enough to follow with the eye
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const LINES = 3; // subtitle box height, in lines (fixed, so the dock never changes height)
const LEADING = 1.5;

export default function AssistantDock({ mode, status, subtitle, orbProps, originRef, choices, onChoose, compact = false }: Props) {
  const text = (subtitle ?? '').trim();
  const ORB = useIsMobile() ? ORB_MOBILE : ORB_DESKTOP;
  const orbRef = React.useRef<HTMLButtonElement | null>(null);

  // the home orb comes down: a copy of it — same size, same place, above everything (the sheet would clip it) —
  // glides down into the dock, shrinking as it goes, following where the dock's orb really is on every frame; on
  // landing it hands over to the dock's orb, which settles with a little bounce. One orb, travelling.
  const [flight, setFlight] = React.useState<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    const btn = orbRef.current;
    if (!btn?.animate) return;
    const from = originRef?.current?.getBoundingClientRect();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!from?.width || reduce) {
      btn.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'both' });
      return;
    }
    setFlight(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const landed = React.useCallback(() => {
    setFlight(null);
    orbRef.current?.animate?.(
      [
        { transform: 'translate(-50%, 0) scale(1.1)' },
        { transform: 'translate(-50%, 0) scale(0.97)', offset: 0.6 },
        { transform: 'translate(-50%, 0) scale(1)' },
      ],
      { duration: 380, easing: 'ease-out' },
    );
  }, []);

  const answers =
    choices && choices.length > 0 && onChoose ? (
      // "which one?" — one tap answers; inside the scroll, so they never change the dock's height
      <div className="mt-2 flex flex-wrap justify-center gap-2 pb-1" role="group" aria-label="Choose one">
        {choices.map((c) => (
          <button
            key={c.say}
            type="button"
            onClick={() => onChoose(c.say)}
            className="max-w-full truncate rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-gray-800 shadow-sm ring-1 ring-[#FA2851]/15 active:scale-95"
          >
            {c.label}
            {typeof c.price === 'number' && <span className="ml-1.5 font-normal text-gray-500">৳{c.price}</span>}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="relative shrink-0" style={{ paddingTop: ORB / 2 }}>
      <div
        className="qv-motion rounded-t-[32px] bg-gradient-to-b from-[#FFE4EA] to-[#FFF1F4] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        style={{ paddingTop: ORB / 2 + 8, animation: 'qv-dock-rise 450ms cubic-bezier(.2,.9,.2,1) both' }}
      >
        {/* fixed height: the dock (and the orb on it) never moves when the subtitles turn into "Listening…" */}
        <div className="mx-auto max-w-[520px] text-[15px] md:text-[17px]" style={{ lineHeight: LEADING }}>
          <div
            className="overflow-hidden transition-[height,opacity] duration-300 ease-out motion-reduce:transition-none"
            style={{ height: compact ? 0 : `${LINES * LEADING}em`, opacity: compact ? 0 : 1 }}
            aria-hidden={compact || undefined}
          >
          {text ? (
            <ScrollText
              text={text}
              lines={LINES}
              lineHeight={LEADING}
              className="text-center font-medium tracking-[-0.01em] text-[#1F1F1F]"
              after={answers}
            />
          ) : (
            <div className="flex flex-col items-center justify-center" style={{ height: `${LINES * LEADING}em` }}>
              {status && (
                <p role="status" aria-live="polite" className="text-center font-medium text-[#FA2851]/80">
                  {status}
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* the orb on the panel's top edge — it IS the mic: hold to talk */}
      <button
        ref={orbRef}
        type="button"
        {...orbProps}
        aria-label={mode === 'listening' ? 'Listening — release to send' : 'Hold to talk'}
        className="absolute left-1/2 top-0 z-10 select-none touch-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FA2851]/40"
        style={{
          width: ORB,
          height: ORB,
          transform: 'translate(-50%, 0)',
          opacity: flight ? 0 : 1, // (the travelling copy is it, until it lands)
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <TenminOrb mode={mode} size={ORB} />
      </button>
      {flight && <OrbFlight from={flight} targetRef={orbRef} mode={mode} onLanded={landed} />}
    </div>
  );
}

/** The home orb on its way down: drawn above the page at the home orb's exact size and place, it moves (and
 *  shrinks) toward the dock's orb, re-measured every frame — the sheet may still be settling. */
function OrbFlight({
  from,
  targetRef,
  mode,
  onLanded,
}: {
  from: DOMRect;
  targetRef: React.RefObject<HTMLElement | null>;
  mode: OrbMode;
  onLanded: () => void;
}) {
  const size = Math.round(from.width / BALL); // the home orb's own size (its ball is `from`)
  const elRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / FLIGHT_MS);
      const to = targetRef.current?.getBoundingClientRect();
      const tx = to ? to.left + to.width / 2 : fx;
      const ty = to ? to.top + to.height / 2 : fy;
      const endScale = to?.width ? to.width / size : 1;
      const m = easeInOut(t); // the path: eases out of the home spot, glides, eases into the dock
      const k = 1 + (endScale - 1) * easeOut(t); // shrinks early, so it reads as going down and away
      el.style.transform = `translate(${fx + (tx - fx) * m - size / 2}px, ${fy + (ty - fy) * m - size / 2}px) scale(${k})`;
      if (t < 1) raf = requestAnimationFrame(frame);
      else onLanded();
    };
    frame(t0);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      ref={elRef}
      aria-hidden
      className="pointer-events-none"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: size,
        height: size,
        zIndex: 300, // above the sheets (z-100)
        transformOrigin: '50% 50%',
        willChange: 'transform',
        filter: 'drop-shadow(0 14px 28px rgba(250, 40, 81, 0.25))',
      }}
    >
      <TenminOrb mode={mode} size={size} />
    </div>,
    document.body,
  );
}
