// apps/tastebud/src/components/ai-waiter/TrayPicks.tsx
// Suggestions shown INSIDE the tray — visibly "not in your tray yet" (dashed, glowing, labelled) — and the
// fly-in animation when one is added (by tap or by voice): the card lifts off, arcs into its new tray line,
// and lands with a sparkle burst.
import { useEffect, useRef } from 'react';
import { money, tr, uiLang } from '../../utils/ui-lang';

export type TrayPick = {
  id: string;
  name: string;
  price?: number;
  imageUrl?: string;
  reason?: string;
};

export type Flight = {
  id: number;
  name: string;
  imageUrl?: string;
  from: DOMRect;
  to: DOMRect;
};

const KEYFRAMES = `
@keyframes qravyPickIn { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes qravyShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes qravyPop { 0% { opacity: 0; transform: translate(-50%, 0) scale(.6); } 30% { opacity: 1; transform: translate(-50%, -18px) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -46px) scale(1); } }
`;

function useKeyframes() {
  useEffect(() => {
    if (document.getElementById('qravy-tray-picks-kf')) return;
    const el = document.createElement('style');
    el.id = 'qravy-tray-picks-kf';
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

/** The "waiter's picks" section — deliberately unlike a tray line. */
export function TrayPicks({
  picks,
  onAdd,
  registerRef,
  highlightIds = [],
}: {
  picks: TrayPick[];
  onAdd: (p: TrayPick) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
  /** the pick(s) the waiter pointed at ("which of these is less spicy?") */
  highlightIds?: string[];
}) {
  useKeyframes();
  const lang = 'en' as const; // UI chrome stays English
  if (!picks.length) return null;
  const hl = new Set(highlightIds);
  return (
    <section
      aria-label={tr(lang, 'ওয়েটারের পছন্দ', "Waiter's picks")}
      className="mt-5 rounded-3xl p-3 bg-gradient-to-br from-amber-50 via-rose-50 to-violet-50 ring-1 ring-rose-100"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">✨</span>
        <span className="text-[13px] font-semibold text-gray-900">{tr(lang, 'ওয়েটারের পছন্দ', "Waiter's picks")}</span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-500 ring-1 ring-rose-200">
          {tr(lang, 'এখনো ট্রেতে নেই', 'not in your tray yet')}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-gray-500">
        {tr(lang, 'যেটা চান বলুন — "প্রথমটা দিন" — অথবা + চাপুন', 'Say which one — "add the first one" — or tap +')}
      </p>
      <div className="space-y-2">
        {picks.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => registerRef(p.id, el)}
            style={{ animation: `qravyPickIn .45s ${i * 90}ms both cubic-bezier(.2,.8,.2,1)` }}
            className={
              'relative flex items-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed p-2.5 transition-all duration-500 ' +
              (hl.has(p.id)
                ? 'border-[#FA2851]/60 bg-white ring-2 ring-[#FA2851]/15'
                : 'border-rose-200 bg-white/70')
            }
          >

            {/* slow shimmer: this is an idea, not an order */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
              style={{
                background: 'linear-gradient(110deg, transparent 30%, rgba(250,40,81,.08) 50%, transparent 70%)',
                backgroundSize: '200% 100%',
                animation: 'qravyShimmer 3.2s linear infinite',
              }}
            />
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-500">
              {i + 1}
            </span>
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="relative h-10 w-10 rounded-xl object-cover" />
            ) : null}
            <div className="relative min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-gray-900">{p.name}</div>
              <div className="truncate text-[11px] text-gray-500">
                {typeof p.price === 'number' ? money(p.price) : ''}
                {p.reason ? `${typeof p.price === 'number' ? ' · ' : ''}${p.reason}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAdd(p)}
              className="relative shrink-0 rounded-full bg-[#FA2851] px-3 py-1.5 text-[12px] font-semibold text-white shadow-md shadow-rose-200 active:scale-95"
            >
              + {tr(lang, 'ট্রেতে দিন', 'Add')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One card flying from its pick spot into its new tray line. */
function FlyingCard({ f, onDone }: { f: Flight; onDone: (id: number) => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const burstRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const dx = f.to.left + f.to.width / 2 - (f.from.left + f.from.width / 2);
    const dy = f.to.top + f.to.height / 2 - (f.from.top + f.from.height / 2);
    const lift = Math.min(160, Math.abs(dy) * 0.5 + 60);
    const fly = el.animate(
      [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, boxShadow: '0 6px 18px rgba(0,0,0,.12)' },
        { transform: 'translate(0,-10px) scale(1.06) rotate(-2deg)', opacity: 1, offset: 0.15, boxShadow: '0 24px 48px rgba(250,40,81,.35)' },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.5 - lift}px) scale(.92) rotate(-8deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.35) rotate(0deg)`, opacity: 0.1 },
      ],
      { duration: 820, easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'forwards' },
    );
    fly.onfinish = () => {
      try {
        navigator.vibrate?.(30);
      } catch {
        /* unsupported */
      }
      // sparkle burst where it landed
      const b = burstRef.current;
      if (b) {
        b.style.display = 'block';
        Array.from(b.children).forEach((c, i) => {
          if (!(c instanceof HTMLElement) || c.dataset.pop) return;
          const angle = (i / 10) * Math.PI * 2;
          const dist = 34 + (i % 3) * 14;
          c.animate(
            [
              { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
              { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(1)`, opacity: 0 },
            ],
            { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
          );
        });
      }
      window.setTimeout(() => onDone(f.id), 700);
    };
    return () => fly.cancel();
  }, [f, onDone]);

  const cx = f.to.left + f.to.width / 2;
  const cy = f.to.top + f.to.height / 2;
  const colors = ['#FA2851', '#FFB020', '#7C5CFF', '#10B981', '#FF7AA2'];
  return (
    <>
      <div
        ref={cardRef}
        className="fixed z-[1300] flex items-center gap-2 overflow-hidden rounded-2xl border-2 border-[#FA2851] bg-white px-3"
        style={{ left: f.from.left, top: f.from.top, width: f.from.width, height: f.from.height }}
      >
        {f.imageUrl ? <img src={f.imageUrl} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span aria-hidden="true">🍽️</span>}
        <span className="truncate text-sm font-semibold text-gray-900">{f.name}</span>
      </div>
      <div ref={burstRef} className="pointer-events-none fixed z-[1301]" style={{ left: cx, top: cy, display: 'none' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className="absolute block h-2 w-2 rounded-full"
            style={{ left: 0, top: 0, background: colors[i % colors.length] }}
          />
        ))}
        <span
          data-pop="1"
          className="absolute whitespace-nowrap rounded-full bg-[#FA2851] px-2 py-0.5 text-xs font-bold text-white"
          style={{ left: 0, top: -8, animation: 'qravyPop .9s both' }}
        >
          +1
        </span>
      </div>
    </>
  );
}

export function FlightLayer({ flights, onDone }: { flights: Flight[]; onDone: (id: number) => void }) {
  useKeyframes();
  return (
    <>
      {flights.map((f) => (
        <FlyingCard key={f.id} f={f} onDone={onDone} />
      ))}
    </>
  );
}
