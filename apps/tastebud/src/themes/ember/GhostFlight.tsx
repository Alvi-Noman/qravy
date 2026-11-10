// apps/tastebud/src/themes/ember/GhostFlight.tsx
// A suggestion going into the order — the same move as the original theme's tray (components/ai-waiter/TrayPicks):
// when a suggested dish gets into the order (tapped "Add" or said "yes"), its card lifts off, arcs down into its
// new order line and lands with a small burst and "+1"; the line stays hidden while the card is in the air, then
// pops in. Ember colours (amber on dark), the same timing.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EM } from './ui';

export type GhostFlightT = { id: number; name: string; imageUrl?: string; from: DOMRect; to: DOMRect };

export const FLY_MS = 820;

function Flying({ f, onDone }: { f: GhostFlightT; onDone: (id: number) => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const burstRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dx = f.to.left + f.to.width / 2 - (f.from.left + f.from.width / 2);
    const dy = f.to.top + f.to.height / 2 - (f.from.top + f.from.height / 2);
    const lift = Math.min(160, Math.abs(dy) * 0.5 + 60);
    const fly = el.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, boxShadow: '0 6px 18px rgba(0,0,0,.4)' },
            { transform: 'translate(0,-10px) scale(1.05) rotate(-2deg)', opacity: 1, offset: 0.15, boxShadow: '0 24px 48px rgba(245,165,36,.35)' },
            { transform: `translate(${dx * 0.55}px, ${dy * 0.5 - lift}px) scale(.92) rotate(-6deg)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${dx}px, ${dy}px) scale(.4) rotate(0deg)`, opacity: 0.1 },
          ],
      { duration: reduce ? 200 : FLY_MS, easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'forwards' },
    );
    fly.onfinish = () => {
      try {
        navigator.vibrate?.(30);
      } catch {
        /* unsupported */
      }
      const b = burstRef.current;
      if (b && !reduce) {
        b.style.display = 'block';
        Array.from(b.children).forEach((c, i) => {
          if (!(c instanceof HTMLElement) || c.dataset.pop) return;
          const angle = (i / 8) * Math.PI * 2;
          const dist = 28 + (i % 3) * 12;
          c.animate(
            [
              { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
              { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(1)`, opacity: 0 },
            ],
            { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
          );
        });
        (b.querySelector('[data-pop]') as HTMLElement | null)?.animate(
          [
            { transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
            { transform: 'translate(-50%,-18px) scale(1.1)', opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%,-44px) scale(1)', opacity: 0 },
          ],
          { duration: 900, fill: 'forwards' },
        );
      }
      window.setTimeout(() => onDone(f.id), 700);
    };
    return () => fly.cancel();
  }, [f, onDone]);

  const cx = f.to.left + f.to.width / 2;
  const cy = f.to.top + f.to.height / 2;
  const dots = [EM.amber, '#FFD08A', '#F5F5F7', EM.amber, '#C9781A', '#FFD08A', '#F5F5F7', EM.amber];
  return (
    <>
      <div
        ref={cardRef}
        aria-hidden="true"
        className="pointer-events-none fixed z-[1300] flex items-center gap-2.5 overflow-hidden rounded-[14px] px-3"
        style={{ left: f.from.left, top: f.from.top, width: f.from.width, height: f.from.height, background: EM.amberTint, border: `1.5px solid ${EM.amber}`, color: EM.text }}
      >
        {f.imageUrl && <img src={f.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />}
        <span className="truncate text-[15px] font-semibold">{f.name}</span>
      </div>
      <div ref={burstRef} aria-hidden="true" className="pointer-events-none fixed z-[1301]" style={{ left: cx, top: cy, display: 'none' }}>
        {dots.map((c, i) => (
          <span key={i} className="absolute block h-1.5 w-1.5 rounded-full" style={{ left: 0, top: 0, background: c }} />
        ))}
        <span
          data-pop="1"
          className="absolute whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-bold"
          style={{ left: 0, top: -8, background: EM.amber, color: EM.bg, opacity: 0 }}
        >
          +1
        </span>
      </div>
    </>
  );
}

export function GhostFlights({ flights, onDone }: { flights: GhostFlightT[]; onDone: (id: number) => void }) {
  if (!flights.length) return null;
  return createPortal(
    <>
      {flights.map((f) => (
        <Flying key={f.id} f={f} onDone={onDone} />
      ))}
    </>,
    document.body,
  );
}
