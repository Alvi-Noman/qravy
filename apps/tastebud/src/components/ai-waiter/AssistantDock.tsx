// apps/tastebud/src/components/ai-waiter/AssistantDock.tsx
// The waiter's presence at the bottom of a popup (the cards, the tray): a soft pink panel rises from the bottom
// edge, and the home screen's orb travels down into it — shrinking as it goes — to settle on its top edge. What the
// waiter says plays as subtitles inside (scroll them to read back). HOLD the orb to talk.
import React from 'react';
import TenminOrb from './TenminOrb';
import { ballOf, flyOrb, settle, type Flight } from './orbFlight';
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

const LINES = 3; // subtitle box height, in lines (fixed, so the dock never changes height)
const LEADING = 1.5;

export default function AssistantDock({ mode, status, subtitle, orbProps, originRef, choices, onChoose, compact = false }: Props) {
  const text = (subtitle ?? '').trim();
  const ORB = useIsMobile() ? ORB_MOBILE : ORB_DESKTOP;
  const orbRef = React.useRef<HTMLButtonElement | null>(null);

  // ONE orb, travelling (orbFlight): when the sheet opens, the home orb glides down into the dock (shrinking as it
  // goes) and becomes this orb; when the sheet closes, this orb glides back up and becomes the home orb again.
  const [inFlight, setInFlight] = React.useState(false);
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  React.useLayoutEffect(() => {
    const btn = orbRef.current;
    const origin = originRef?.current ?? null;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const home = () => (origin?.isConnected && origin.getBoundingClientRect().width ? origin.getBoundingClientRect() : null);
    const dockBall = () => (orbRef.current?.isConnected ? ballOf(orbRef.current.getBoundingClientRect(), BALL) : null);

    let down: Flight | null = null;
    const start = home();
    if (!btn || !start || reduce) {
      btn?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'both' });
    } else {
      setInFlight(true);
      down = flyOrb({
        from: ballOf(start),
        to: dockBall,
        mode: modeRef.current,
        onLanded: () => {
          down = null;
          setInFlight(false);
          settle(orbRef.current, 'translate(-50%, 0)');
        },
      });
    }

    return () => {
      // where this orb is as the sheet closes (still on screen at this moment) — or the copy, mid-way down
      const from = down ? down.now() : btn?.isConnected ? ballOf(btn.getBoundingClientRect(), BALL) : null;
      down?.cancel();
      if (!from || !origin || reduce) return;
      requestAnimationFrame(() => {
        // (React's dev double-mount "unmounts" without removing anything — only a real close flies home)
        if (btn?.isConnected) return;
        if (!home()) return; // left the home screen altogether
        const prev = origin.style.opacity;
        origin.style.opacity = '0'; // the copy is the home orb until it lands
        const restore = () => {
          origin.style.opacity = prev;
        };
        flyOrb({
          from,
          to: () => (home() ? ballOf(origin.getBoundingClientRect()) : null),
          mode: modeRef.current,
          onLanded: () => {
            restore();
            settle(origin);
          },
        });
        window.setTimeout(restore, 1600); // never leave the home orb invisible (the page changed mid-flight)
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          opacity: inFlight ? 0 : 1, // (the travelling copy is it, until it lands)
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <TenminOrb mode={mode} size={ORB} />
      </button>
    </div>
  );
}
