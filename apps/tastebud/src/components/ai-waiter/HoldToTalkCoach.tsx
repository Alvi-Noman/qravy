// apps/tastebud/src/components/ai-waiter/HoldToTalkCoach.tsx
// First-run coachmark on the waiter screen: once the welcome has been spoken, everything except the orb dims and
// blurs, the orb gets a pulsing halo, and a hand-drawn arrow curves from "Hold to talk" into it. The page keeps the
// orb above this layer (so holding it works — and dismisses this), and the language switch above it too.
// Shown once per phone (see holdCoachSeen); holding the orb, a phrase or a tap anywhere dismisses it.
import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const SEEN_KEY = 'qravy:holdCoachSeen';

export function holdCoachSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked → never nag (it would show on every visit)
  }
}

export function markHoldCoachSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage blocked */
  }
}

const COPY = {
  bn: { title: 'ট্যাপ করুন বা চেপে ধরে বলুন', sub: 'বৃত্তটায় ট্যাপ করে বলুন — অথবা চেপে ধরে বলে ছেড়ে দিন', try: 'যেমন বলুন:' },
  en: { title: 'Tap or hold to talk', sub: 'Tap the circle and speak — or hold it, speak, then let go', try: 'Try saying:' },
} as const;

export default function HoldToTalkCoach({
  ballRef,
  lang,
  onDismiss,
  examples = [],
  onSay,
}: {
  /** The orb's ball — the halo and the arrow are drawn around it */
  ballRef: RefObject<HTMLElement | null>;
  lang: 'bn' | 'en';
  onDismiss: () => void;
  /** what the guest could say ("এখন কী খেতে পারি?") — shown under the how, a tap says it (and closes this) */
  examples?: string[];
  onSay?: (text: string) => void;
}) {
  const c = COPY[lang];
  const [orb, setOrb] = useState<{ x: number; y: number; r: number } | null>(null);

  const measure = useCallback(() => {
    const r = ballRef.current?.getBoundingClientRect();
    if (r && r.width) setOrb({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
  }, [ballRef]);
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (!orb) return null;

  // the arrow: from above the label, a loose curve out to the right and back into the orb's lower-right edge
  const { x, y, r } = orb;
  const sx = x + 34, sy = y + r + 92;
  const ex = x + r * 0.78, ey = y + r * 0.72;
  const c1x = x + r + 70, c1y = sy - 6;
  const c2x = x + r + 64, c2y = ey + 8;
  const ang = Math.atan2(ey - c2y, ex - c2x); // the arrowhead follows the curve's last tangent
  const L = 13, spread = 0.5;
  const head = `M ${ex - L * Math.cos(ang - spread)} ${ey - L * Math.sin(ang - spread)} L ${ex} ${ey} L ${
    ex - L * Math.cos(ang + spread)
  } ${ey - L * Math.sin(ang + spread)}`;

  return (
    <div role="dialog" aria-modal="false" aria-label={c.title} className="fixed inset-0 z-[1440]" onClick={onDismiss}>
      <style>{`
        @keyframes htc-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes htc-up { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
        @keyframes htc-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes htc-halo { 0% { transform: translate(-50%, -50%) scale(1); opacity: .55 } 100% { transform: translate(-50%, -50%) scale(1.45); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { .htc-motion { animation: none !important } }
      `}</style>

      {/* dim + blur everything behind (the orb sits above this layer) */}
      {/* (dark enough that the welcome text behind never shows through the label) */}
      <div className="htc-motion absolute inset-0 bg-black/80 backdrop-blur-[6px]" style={{ animation: 'htc-fade 350ms ease-out both' }} />

      {/* the halo: a soft light behind the orb, and two rings breathing out of it */}
      <span
        aria-hidden="true"
        className="htc-motion pointer-events-none absolute rounded-full"
        style={{
          left: x - r - 20,
          top: y - r - 20,
          width: (r + 20) * 2,
          height: (r + 20) * 2,
          background: 'radial-gradient(circle, rgba(255,255,255,.28) 55%, rgba(255,255,255,0) 72%)',
          animation: 'htc-fade 350ms ease-out both',
        }}
      />
      {[0, 1].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="htc-motion pointer-events-none absolute rounded-full ring-[3px] ring-white/80"
          style={{ left: x, top: y, width: r * 2, height: r * 2, animation: `htc-halo 2.2s ease-out ${i * 1.1}s infinite` }}
        />
      ))}

      {/* the hand-drawn arrow */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <path
          d={`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`}
          pathLength={1}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="1"
          className="htc-motion"
          style={{ animation: 'htc-draw 700ms cubic-bezier(.4,0,.2,1) 250ms both' }}
        />
        <path
          d={head}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="htc-motion"
          style={{ animation: 'htc-fade 200ms ease-out 900ms both' }}
        />
      </svg>

      {/* the label */}
      <div
        className="htc-motion absolute w-[330px] max-w-[calc(100vw-32px)] text-center text-white"
        style={{ left: x, top: sy + 14, transform: 'translateX(-50%)', animation: 'htc-up 400ms ease-out 450ms both' }}
      >
        <div className="text-[22px] font-bold leading-tight tracking-[-0.01em]">{c.title}</div>
        <div className="mt-1.5 text-[14px] leading-snug text-white/80">{c.sub}</div>
        {/* how, made concrete: the things they could say — a tap says it */}
        {examples.length > 0 && onSay && (
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-white/60">{c.try}</div>
            <div className="flex flex-wrap justify-center gap-2" role="group" aria-label={c.try}>
              {examples.map((say) => (
                <button
                  key={say}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSay(say);
                  }}
                  className="whitespace-nowrap rounded-full border border-white/40 bg-white/15 px-3.5 py-2 text-[14px] font-medium text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
                >
                  “{say}”
                </button>
              ))}
            </div>
          </div>
        )}
        {/* no "Got it": the ways out are the ones it teaches — the orb, a phrase — or a tap anywhere */}
      </div>
    </div>
  );
}
