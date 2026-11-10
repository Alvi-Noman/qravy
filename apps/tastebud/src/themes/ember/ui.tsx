// apps/tastebud/src/themes/ember/ui.tsx
// The Ember theme's parts, shared by its pages: the colours, icons, the page frame, the top bar (EN · Call waiter, or the
// Delivery / Pickup chip online), the orb and the bottom bar (Menu · orb · Type), the bars above it (order, live
// status), quick replies, bottom sheets, and the dish "+" that becomes "− 1 +".
// Sizes and colours follow the design handoff (390 × 844 phone; tokens in SPEC.md).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCart, cartLineKey, type CartItem, type CartModifier, type CartWarning } from '../../context/CartContext';
import { isAvailableAt } from '../../utils/availability';
import { callForService, getServiceRequest, type ServiceKind, type ServiceStatus } from '../../api/serviceRequests';
import { money } from '../../utils/ui-lang';
import { track } from '../../utils/track';
import { picksToModifiers, validatePicks, type ModifierGroup, type ModifierPicks } from '../../components/ModifierPicker';
import { createPortal } from 'react-dom';
import { useVisit } from './visit';
import { clockText } from './when';
import './ember.css';

/* ------------------------------------------------------------------ tokens */
export const EM = {
  bg: '#0B0B0C',
  surface: '#151517',
  surface2: '#1C1C1F',
  card: '#111113',
  border: '#2C2C30',
  borderSoft: '#1E1E21',
  text: '#F5F5F7',
  text2: '#D1D1D6',
  text3: '#A1A1A6',
  muted: '#8E8E93',
  faint: '#6E6E73',
  amber: '#F5A524',
  amberTint: '#1B160E',
  amberLine: '#4A3A1E',
  chip: '#17140F',
  chipLine: '#3A3226',
  danger: '#FF8A80',
  ready: '#7DD3A0',
} as const;
export const ORB_GRADIENT = (accent: string = EM.amber) =>
  `radial-gradient(circle at 34% 28%, #FFF1D6 0%, ${accent} 48%, #8A3E08 100%)`;

export type Lang = 'bn' | 'en';
export const tx = (lang: Lang, bn: string, en: string) => (lang === 'en' ? en : bn);

/* ------------------------------------------------------------------- icons */
type IP = { size?: number; className?: string; stroke?: string; sw?: number };
const svg = (d: React.ReactNode, { size = 20, className, stroke = 'currentColor', sw = 2 }: IP, fill = 'none') => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {d}
  </svg>
);
export const I = {
  bell: (p: IP = {}) => svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5" /><path d="M4 16h16" /><path d="M12 5V3" /><path d="M10 20h4" /></>, p),
  menu: (p: IP = {}) => svg(<path d="M4 6h16M4 12h16M4 18h10" />, { sw: 1.8, ...p }),
  keyboard: (p: IP = {}) => svg(<><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" /></>, { sw: 1.8, ...p }),
  mic: (p: IP = {}) => svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>, p),
  back: (p: IP = {}) => svg(<path d="M15 5l-7 7 7 7" />, { size: 24, sw: 2.2, ...p }),
  check: (p: IP = {}) => svg(<path d="M5 12l5 5 9-10" />, { sw: 3, ...p }),
  plus: (p: IP = {}) => svg(<path d="M12 5v14M5 12h14" />, { size: 16, sw: 2.6, ...p }),
  minus: (p: IP = {}) => svg(<path d="M5 12h14" />, { size: 14, sw: 2.6, ...p }),
  trash: (p: IP = {}) => svg(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>, { size: 16, sw: 2.2, ...p }),
  x: (p: IP = {}) => svg(<path d="M6 6l12 12M18 6L6 18" />, { size: 14, sw: 2.4, ...p }),
  sparkle: (p: IP = {}) => svg(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>, { size: 14, ...p }),
  search: (p: IP = {}) => svg(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>, { size: 18, ...p }),
  chevron: (p: IP = {}) => svg(<path d="M9 5l7 7-7 7" />, { size: 16, sw: 2.2, ...p }),
  chevronDown: (p: IP = {}) => svg(<path d="M6 9l6 6 6-6" />, { size: 16, sw: 2.2, ...p }),
  arrowDown: (p: IP = {}) => svg(<path d="M12 5v14M6 13l6 6 6-6" />, { size: 18, sw: 2.2, ...p }),
  arrowUp: (p: IP = {}) => svg(<path d="M12 19V5M6 11l6-6 6 6" />, { size: 18, sw: 2.4, ...p }),
  bike: (p: IP = {}) => svg(<><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17h6l3-6h3" /><path d="M14 7h3l1 4" /></>, { size: 18, sw: 1.9, ...p }),
  bag: (p: IP = {}) => svg(<><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>, { size: 18, sw: 1.9, ...p }),
  globe: (p: IP = {}) => svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>, { size: 16, sw: 1.8, ...p }),
  receipt: (p: IP = {}) => svg(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>, { sw: 1.8, ...p }),
  glass: (p: IP = {}) => svg(<><path d="M7 3h10l-1.5 17a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z" /><path d="M7.5 9h9" /></>, { sw: 1.8, ...p }),
  cutlery: (p: IP = {}) => svg(<><path d="M8 3v8a2 2 0 0 1-2 2v8" /><path d="M5 3v6M11 3v6" /><path d="M17 21V3c2 1 3 4 3 7h-3" /></>, { sw: 1.8, ...p }),
  clear: (p: IP = {}) => svg(<><path d="M3 12h18" /><path d="M5 12l2 8h10l2-8" /><path d="M9 12V5h6v7" /></>, { sw: 1.8, ...p }),
};

/* --------------------------------------------------------------- the frame */
/** Fonts for the theme (Inter for the UI, Inter Tight for captions and headings; Bangla falls back to Noto). */
function useEmberFonts() {
  useEffect(() => {
    const id = 'em-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
  // the browser's own bars match the page
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const was = meta?.content;
    if (meta) meta.content = EM.bg;
    const bodyBg = document.body.style.background;
    document.body.style.background = EM.bg;
    return () => {
      if (meta && was) meta.content = was;
      document.body.style.background = bodyBg;
    };
  }, []);
}

/** The amber light behind the bottom bar — brighter while the guest talks, dimmer while Pixie thinks. */
export type Glow = 'none' | 'calm' | 'listen' | 'think' | 'speak';
function BottomGlow({ glow }: { glow: Glow }) {
  if (glow === 'none') return null;
  const g = {
    calm: { left: -60, bottom: -190, w: 510, h: 400, a: 0.32, b: 0.06 },
    speak: { left: -60, bottom: -190, w: 510, h: 400, a: 0.4, b: 0.08 },
    listen: { left: -100, bottom: -220, w: 590, h: 500, a: 0.55, b: 0.12 },
    think: { left: 25, bottom: -150, w: 340, h: 300, a: 0.22, b: 0 },
  }[glow];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute transition-all duration-500"
      style={{
        left: `calc(50% - 195px + ${g.left}px)`,
        bottom: g.bottom,
        width: g.w,
        height: g.h,
        borderRadius: '50%',
        background: `radial-gradient(closest-side, rgba(245,165,36,${g.a}), rgba(245,165,36,${g.b}) 60%, rgba(245,165,36,0) 100%)`,
      }}
    />
  );
}

/** One screen: a phone-width column the height of the screen. Header and footer stay put; the middle scrolls. */
export function Shell({
  glow = 'calm',
  header,
  footer,
  children,
  edgeGlow = false,
  overlay,
}: {
  glow?: Glow;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** the menu: the screen's edge glows amber while the guest talks / Pixie answers */
  edgeGlow?: boolean;
  overlay?: React.ReactNode;
}) {
  useEmberFonts();
  return (
    <div className="em-root min-h-[100dvh] w-full" style={{ background: EM.bg, color: EM.text }}>
      {/* (clip, not just hidden: "hidden" still lets code scroll the frame — a tab centring itself once slid the whole
          page sideways; phones without clip keep "hidden") */}
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-[480px] flex-col overflow-hidden" style={{ background: EM.bg, overflow: 'clip' }}>
        <BottomGlow glow={glow} />
        {header && <div className="relative z-20 shrink-0 px-4 pt-[calc(env(safe-area-inset-top,0px)+14px)]">{header}</div>}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
        {footer && <div className="relative z-20 shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">{footer}</div>}
        {edgeGlow && (
          <div
            aria-hidden="true"
            className="em-glow pointer-events-none absolute inset-0 z-30"
            style={{ boxShadow: 'inset 0 0 0 2px rgba(245,165,36,0.55), inset 0 0 36px rgba(245,165,36,0.28)' }}
          />
        )}
        {overlay}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the top bar */
export function TopBar({ onBack, title, left, right }: { onBack?: () => void; title?: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-1">
      {onBack && (
        <button type="button" aria-label="Back" onClick={onBack} className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
          {I.back()}
        </button>
      )}
      {title ? (
        <h1 className="em-tight min-w-0 flex-1 truncate text-[24px] font-semibold tracking-[-0.5px]">{title}</h1>
      ) : (
        <div className="min-w-0 flex-1">{left}</div>
      )}
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}

/** EN / বাং — the language the waiter speaks and the site shows. */
export function LangButton({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <button
      type="button"
      aria-label={lang === 'en' ? 'Language: English. Switch to Bangla' : 'ভাষা: বাংলা। ইংরেজিতে বদলান'}
      onClick={() => onChange(lang === 'en' ? 'bn' : 'en')}
      className="h-11 w-11 shrink-0 rounded-full text-[13px] font-semibold"
      style={{ border: `1px solid ${EM.border}`, background: EM.surface, color: EM.text }}
    >
      {lang === 'en' ? 'EN' : 'বাং'}
    </button>
  );
}

/** Online: the compact Delivery / Pickup chip (opens the mode sheet). */
export function ModeChip({ mode, lang, onClick }: { mode: 'delivery' | 'pickup'; lang: Lang; onClick: () => void }) {
  const label = mode === 'delivery' ? tx(lang, 'ডেলিভারি', 'Delivery') : tx(lang, 'পিকআপ', 'Pickup');
  return (
    <button
      type="button"
      aria-label={`Order type: ${label}. Change`}
      onClick={onClick}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-[14px] font-semibold"
      style={{ border: `1px solid ${EM.border}`, background: EM.surface, color: EM.text }}
    >
      <span style={{ color: EM.amber }} className="flex">{mode === 'delivery' ? I.bike() : I.bag()}</span>
      {label}
      <span style={{ color: EM.text3 }} className="flex">{I.chevronDown()}</span>
    </button>
  );
}

/* ---------------------------------------------------------- call a waiter */
type Active = Partial<Record<ServiceKind, { token: string; status: ServiceStatus; at: number }>>;
const KEEP_MS = 2 * 60 * 60 * 1000;
// the same place the original theme keeps a table's calls — switching themes never forgets one
const callKey = (sub: string, table: string) => `qravy:service:${sub}:${table}`;
function readCalls(sub: string, table: string): Active {
  try {
    const raw = JSON.parse(localStorage.getItem(callKey(sub, table)) || '{}') as Active;
    const out: Active = {};
    for (const [k, v] of Object.entries(raw)) if (v && v.status !== 'resolved' && Date.now() - v.at < KEEP_MS) out[k as ServiceKind] = v;
    return out;
  } catch {
    return {};
  }
}

/** The table's calls to staff: what's open, and calling again. */
export function useServiceCalls(sub: string | null, table: string | null, branch: string | null) {
  const [active, setActive] = useState<Active>(() => (sub && table ? readCalls(sub, table) : {}));
  const [hidden, setHidden] = useState<string | null>(null); // the status card the guest closed (by token)
  const save = useCallback(
    (next: Active) => {
      setActive(next);
      try {
        if (sub && table) localStorage.setItem(callKey(sub, table), JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
    },
    [sub, table],
  );
  useEffect(() => {
    if (sub && table) setActive(readCalls(sub, table));
  }, [sub, table]);
  // staff seeing / finishing a call shows here
  const tokens = Object.values(active).map((a) => a!.token).join(',');
  useEffect(() => {
    if (!tokens) return;
    let alive = true;
    const poll = async () => {
      const next: Active = { ...active };
      let changed = false;
      for (const [k, v] of Object.entries(active)) {
        try {
          const r = await getServiceRequest(v!.token);
          if (!r || r.status === 'resolved') {
            delete next[k as ServiceKind];
            changed = true;
          } else if (r.status !== v!.status) {
            next[k as ServiceKind] = { ...v!, status: r.status };
            changed = true;
          }
        } catch {
          /* try again next time */
        }
      }
      if (alive && changed) save(next);
    };
    const id = window.setInterval(poll, 8000);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);
  const call = useCallback(
    async (kind: ServiceKind, note?: string) => {
      if (!sub || !table) throw new Error('no table');
      const r = await callForService({ subdomain: sub, branch, table, kind, note });
      track('call_waiter', { data: { kind } });
      save({ ...active, [kind]: { token: r.token, status: r.status, at: Date.now() } });
      setHidden(null);
      return r;
    },
    [sub, table, branch, active, save],
  );
  const latest = Object.entries(active).sort((a, b) => b[1]!.at - a[1]!.at)[0];
  return {
    active,
    call,
    /** the newest open call, for the header button and the status card */
    latest: latest ? { kind: latest[0] as ServiceKind, ...latest[1]! } : null,
    hidden,
    hide: (token: string) => setHidden(token),
  };
}

export function CallWaiterPill({ state, lang, onClick }: { state: 'none' | 'called' | 'coming'; lang: Lang; onClick: () => void }) {
  if (state !== 'none')
    return (
      <button
        type="button"
        aria-label={state === 'coming' ? tx(lang, 'ওয়েটার আসছেন', 'Waiter on the way') : tx(lang, 'ডাকা হয়েছে', 'Waiter called')}
        onClick={onClick}
        className="flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 text-[14px] font-bold"
        style={{ background: EM.amber, color: EM.bg }}
      >
        {I.check({ size: 18, sw: 2.6 })}
        {state === 'coming' ? tx(lang, 'আসছেন', 'On the way') : tx(lang, 'ডাকা হয়েছে', 'Waiter called')}
      </button>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 text-[14px] font-semibold"
      style={{ border: `1px solid ${EM.amberLine}`, background: EM.amberTint, color: EM.text }}
    >
      <span style={{ color: EM.amber }} className="flex">{I.bell({ size: 18 })}</span>
      {tx(lang, 'ওয়েটার ডাকুন', 'Call waiter')}
    </button>
  );
}

/** 8.2 — the card under the top bar after a call: the restaurant's own confirmation (Settings → Guest messages),
 *  else the original wording; and whether staff have seen it ("On the way") or not yet ("Waiter called"). */
export function CallStatusCard({ message, status, lang, onClose }: { message: string; status: ServiceStatus; lang: Lang; onClose: () => void }) {
  const seen = status === 'acknowledged';
  return (
    <div role="status" className="em-rise mt-3 flex items-center gap-3 rounded-[18px] py-3 pl-4 pr-2" style={{ background: EM.amberTint, border: `1px solid ${EM.amberLine}` }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: EM.amber, color: EM.bg }}>
        {I.check({ size: 14 })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{message}</span>
        <span className="text-[13px]" style={{ color: EM.text3 }}>
          {seen ? tx(lang, 'আসছেন', 'On the way') : tx(lang, 'ডাকা হয়েছে', 'Waiter called')}
        </span>
      </span>
      <button type="button" aria-label={tx(lang, 'লুকান', 'Hide')} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center" style={{ color: EM.text2 }}>
        {I.x({ size: 16 })}
      </button>
    </div>
  );
}

/** 8.1 — "Call a waiter": just call someone, or say what's needed (the bill is how dine-in guests pay). */
export function CallSheet({ open, onClose, lang, onCall }: { open: boolean; onClose: () => void; lang: Lang; onCall: (k: ServiceKind, note?: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState<ServiceKind | null>(null);
  const [err, setErr] = useState('');
  const go = async (k: ServiceKind, note?: string) => {
    setBusy(k);
    setErr('');
    try {
      await onCall(k, note);
      onClose();
    } catch {
      setErr(tx(lang, 'পাঠানো যায়নি — আবার চেষ্টা করুন।', "Couldn't reach the staff — please try again."));
    } finally {
      setBusy(null);
    }
  };
  const tile = (k: ServiceKind, icon: React.ReactNode, label: string, note?: string) => (
    <button
      type="button"
      disabled={!!busy}
      onClick={() => go(k, note)}
      className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[18px] text-[15px] font-medium disabled:opacity-60"
      style={{ border: `1px solid ${EM.border}`, background: '#1E1E21', color: EM.text }}
    >
      {icon}
      {busy === k ? '…' : label}
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} label={tx(lang, 'ওয়েটার ডাকুন', 'Call a waiter')} bg="#17171A">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="em-tight text-[24px] font-semibold">{tx(lang, 'ওয়েটার ডাকুন', 'Call a waiter')}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: EM.border }}>
            {I.x({ size: 18, sw: 2.2 })}
          </button>
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => go('waiter')}
          className="flex h-[58px] items-center justify-center gap-2.5 rounded-full text-[17px] font-bold disabled:opacity-60"
          style={{ background: EM.amber, color: EM.bg }}
        >
          {I.bell({ size: 20, sw: 2.2 })}
          {busy === 'waiter' ? tx(lang, 'ডাকা হচ্ছে…', 'Calling…') : tx(lang, 'ওয়েটার ডাকুন', 'Call a waiter')}
        </button>
        <span className="text-[12px] font-semibold tracking-[1px]" style={{ color: EM.text3 }}>
          {tx(lang, 'অথবা কী লাগবে বলুন', 'OR TELL THEM WHAT YOU NEED')}
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          {tile('bill', I.receipt(), tx(lang, 'বিল দিন', 'Bring the bill'))}
          {tile('water', I.glass(), tx(lang, 'পানি দিন', 'Water, please'))}
          {tile('other', I.cutlery(), tx(lang, 'কাটলারি', 'Cutlery'), 'Cutlery, please')}
          {tile('cleanup', I.clear(), tx(lang, 'টেবিল পরিষ্কার', 'Clean the table'))}
        </div>
        {err && <p className="text-center text-[13px]" style={{ color: EM.danger }}>{err}</p>}
        <p className="text-center text-[14px]" style={{ color: EM.text3 }}>
          {tx(lang, 'আর কিছু? শুধু Pixie-কে বলুন।', 'Anything else? Just tell Pixie.')}
        </p>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------- bottom sheet */
export function Sheet({
  open,
  onClose,
  label,
  children,
  bg = EM.surface,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  bg?: string;
}) {
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex justify-center">
      <div aria-hidden="true" className="em-fade absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)' }} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[480px] items-end">
        <div
          role="dialog"
          aria-label={label}
          className="em-sheet relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] px-5 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] pt-3"
          style={{ background: bg, borderTop: `1px solid ${EM.border}`, transform: drag ? `translateY(${drag}px)` : undefined }}
        >
          <div
            className="-mx-5 -mt-3 flex cursor-grab touch-none justify-center pb-4 pt-3"
            onPointerDown={(e) => {
              startY.current = e.clientY;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => startY.current !== null && setDrag(Math.max(0, e.clientY - startY.current))}
            onPointerUp={() => {
              if (drag > 80) onClose();
              startY.current = null;
              setDrag(0);
            }}
          >
            <div aria-hidden="true" className="h-[5px] w-10 rounded-full" style={{ background: '#3A3A3F' }} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- orb */
export type OrbMode = 'idle' | 'listening' | 'thinking' | 'talking';

/** The mic — always bottom-centre, 88 px inside a 112 px ring; only its state changes. */
export function Orb({
  mode,
  label,
  pressProps,
  ballRef,
  accent = EM.amber,
  ariaLabel,
}: {
  mode: OrbMode;
  label: string;
  pressProps?: React.HTMLAttributes<HTMLButtonElement>;
  ballRef?: React.Ref<HTMLButtonElement>;
  accent?: string;
  ariaLabel?: string;
}) {
  const listening = mode === 'listening';
  const thinking = mode === 'thinking';
  const talking = mode === 'talking';
  const size = listening ? 96 : thinking ? 84 : 88;
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative flex h-[112px] w-[112px] items-center justify-center">
        {listening ? (
          <>
            <div aria-hidden="true" className="em-ring absolute h-[148px] w-[148px] rounded-full" style={{ border: `1px solid ${accent}` }} />
            <div aria-hidden="true" className="absolute h-[120px] w-[120px] rounded-full" style={{ border: `2px solid ${accent}`, opacity: 0.5 }} />
          </>
        ) : thinking ? (
          <div aria-hidden="true" className="em-spin absolute h-[108px] w-[108px] rounded-full" style={{ border: `1.5px dashed ${accent}`, opacity: 0.45 }} />
        ) : (
          <div aria-hidden="true" className="absolute h-[112px] w-[112px] rounded-full" style={{ border: `1px solid ${accent}`, opacity: talking ? 0.3 : 0.25 }} />
        )}
        <button
          type="button"
          ref={ballRef}
          {...pressProps}
          aria-label={ariaLabel ?? label}
          className={`relative flex select-none touch-none items-center justify-center rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/40 ${talking ? 'em-speak' : ''}`}
          style={{
            width: size,
            height: size,
            background: thinking
              ? `radial-gradient(circle at 60% 70%, #FFF1D6 0%, ${accent} 45%, #8A3E08 100%)`
              : ORB_GRADIENT(accent),
            opacity: thinking ? 0.75 : 1,
            boxShadow: listening
              ? '0 0 70px 14px rgba(245,165,36,0.5)'
              : thinking
              ? '0 0 30px 2px rgba(245,165,36,0.2)'
              : '0 0 50px 8px rgba(245,165,36,0.35)',
          }}
        >
          {listening ? (
            <span aria-hidden="true" className="em-wave flex h-[34px] items-center gap-1">
              {[10, 24, 34, 18, 28, 12].map((h, i) => (
                <span key={i} className="w-1 rounded-sm" style={{ height: h, background: '#3A1A00' }} />
              ))}
            </span>
          ) : thinking ? (
            <span aria-hidden="true" className="em-dots flex gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#3A1A00' }} />
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#3A1A00' }} />
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#3A1A00' }} />
            </span>
          ) : (
            I.mic({ size: 32, stroke: '#3A1A00' })
          )}
        </button>
      </div>
      <span className="max-w-[150px] text-center text-[13px] font-semibold leading-tight" style={{ color: thinking ? EM.text2 : EM.text }}>
        {label}
      </span>
    </div>
  );
}

/** Menu · orb · Type. On the menu, its button is white (you're here). */
export function BottomBar({
  orb,
  onMenu,
  onType,
  menuActive = false,
  lang,
}: {
  orb: React.ReactNode;
  onMenu: () => void;
  onType: () => void;
  menuActive?: boolean;
  lang: Lang;
}) {
  const side = (label: string, icon: React.ReactNode, onClick: () => void, active = false, aria?: string) => (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={aria ?? label}
        onClick={onClick}
        className="flex h-14 w-14 items-center justify-center rounded-full active:scale-95"
        style={active ? { background: EM.text, color: EM.bg } : { border: `1px solid ${EM.border}`, background: EM.surface, color: EM.text }}
      >
        {icon}
      </button>
      <span className="text-[12px]" style={{ color: active ? EM.text : EM.text3, fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
  return (
    <div className="flex items-end justify-center gap-10 pt-2">
      {side(tx(lang, 'মেনু', 'Menu'), I.menu(), onMenu, menuActive, menuActive ? tx(lang, 'মেনু বন্ধ করুন', 'Close menu') : tx(lang, 'মেনু খুলুন', 'Open menu'))}
      {orb}
      {side(tx(lang, 'লিখুন', 'Type'), I.keyboard(), onType, false, tx(lang, 'লিখে বলুন', 'Type a message'))}
    </div>
  );
}

/* ---------------------------------------------------- bars above the orb */
/** White "View order · ৳ · N" (or "New items · …" when an order is already in the kitchen). */
export function OrderBar({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="em-rise mx-6 flex h-[54px] items-center justify-between rounded-full pl-5 pr-2"
      style={{ background: EM.text, color: EM.bg }}
    >
      <span className="text-[15px] font-semibold">{label}</span>
      <span className="flex h-[38px] min-w-[38px] items-center justify-center rounded-full px-3 text-[14px] font-semibold" style={{ background: EM.bg, color: EM.text }}>
        {count}
      </span>
    </button>
  );
}

/** A little countdown ring with the minutes in it (Home's live status). */
export function MiniRing({ minutes, fraction }: { minutes: number | null; fraction: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <span aria-hidden="true" className="relative h-[34px] w-[34px] shrink-0">
      <svg width="34" height="34" className="absolute inset-0">
        <circle cx="17" cy="17" r={r} fill="none" stroke={EM.chipLine} strokeWidth="3" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={EM.amber} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * Math.max(0.04, Math.min(1, fraction))} ${c}`} transform="rotate(-90 17 17)" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold">
        {minutes == null ? <span className="em-pulse h-2 w-2 rounded-full" style={{ background: EM.amber }} /> : minutes}
      </span>
    </span>
  );
}

/** 7.1 — "Cooking · ready ~8:42 PM", with the ring; taps through to the order. */
export function LiveStatusBar({ title, sub, minutes, fraction, onClick, lang }: { title: string; sub: string; minutes: number | null; fraction: number; onClick: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="em-rise mx-6 flex h-[58px] items-center gap-3.5 rounded-full pl-3 pr-4 text-left"
      style={{ border: `1px solid ${EM.amberLine}`, background: EM.amberTint, color: EM.text }}
    >
      <MiniRing minutes={minutes} fraction={fraction} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        <span className="truncate text-[13px]" style={{ color: EM.text3 }}>{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[14px] font-semibold" style={{ color: EM.amber }}>
        {tx(lang, 'দেখুন', 'Track')}
        {I.chevron()}
      </span>
    </button>
  );
}

/** The slim "● Sent order · in the kitchen · Track" strip, above a "New items" bar. */
export function StatusStrip({ label, onClick, lang }: { label: string; onClick: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="em-rise mx-6 flex h-11 items-center gap-3 rounded-full pl-4 pr-3.5"
      style={{ border: `1px solid ${EM.amberLine}`, background: EM.amberTint, color: EM.text }}
    >
      <span aria-hidden="true" className="em-pulse h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: EM.amber }} />
      <span className="min-w-0 flex-1 truncate text-left text-[14px]">
        <span className="font-semibold">{tx(lang, 'পাঠানো অর্ডার', 'Sent order')}</span>
        <span style={{ color: EM.text3 }}> · {label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[14px] font-semibold" style={{ color: EM.amber }}>
        {tx(lang, 'দেখুন', 'Track')}
        {I.chevron()}
      </span>
    </button>
  );
}

/* ----------------------------------------------------------- quick replies */
export type Chip = { label: string; onClick: () => void; primary?: boolean; key?: string };

/** What the guest could say next — one row, centred under the orb when it fits, else scrolling sideways. */
export function QuickReplies({ chips, label = 'Quick replies' }: { chips: Chip[]; label?: string }) {
  if (!chips.length) return null;
  return (
    <div role="group" aria-label={label} className="em-noscroll em-rise flex gap-2 overflow-x-auto px-6" style={{ justifyContent: 'safe center' }}>
      {chips.map((c) =>
        c.primary ? (
          <button
            key={c.key ?? c.label}
            type="button"
            onClick={c.onClick}
            className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pl-3 pr-4 text-[15px] font-bold"
            style={{ background: EM.amber, color: EM.bg }}
          >
            {I.check({ size: 16, sw: 2.8 })}
            {c.label}
          </button>
        ) : (
          <button
            key={c.key ?? c.label}
            type="button"
            onClick={c.onClick}
            className="h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-[15px] font-medium"
            style={{ border: `1px solid ${EM.chipLine}`, background: EM.chip, color: EM.text }}
          >
            {c.label}
          </button>
        ),
      )}
    </div>
  );
}

/** "✦ SUGGESTED FOR YOU · See all picks ›" with its chips (Home). */
export function SuggestedForYou({ chips, onSeeAll, lang }: { chips: Chip[]; onSeeAll: () => void; lang: Lang }) {
  return (
    <div className="em-rise flex flex-col gap-1 px-6">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[1.2px]" style={{ color: EM.text3 }}>
          <span style={{ color: EM.amber }} className="flex">{I.sparkle()}</span>
          {tx(lang, 'আপনার জন্য', 'SUGGESTED FOR YOU')}
        </span>
        <button type="button" aria-label="See all AI picks" onClick={onSeeAll} className="-mr-2 flex h-11 items-center gap-0.5 pl-3 pr-2 text-[14px] font-semibold" style={{ color: EM.amber }}>
          {tx(lang, 'সব দেখুন', 'See all picks')}
          {I.chevron()}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key ?? c.label}
            type="button"
            onClick={c.onClick}
            className="h-11 rounded-full px-4 text-[15px] font-medium"
            style={{ border: `1px solid ${EM.chipLine}`, background: EM.chip, color: EM.text }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The round ↓ that floats above the bars while there's more to read below. */
export function ScrollDown({ scroller }: { scroller: React.RefObject<HTMLElement> }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [scroller]);
  if (!more) return null;
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-7" style={{ background: `linear-gradient(rgba(11,11,12,0), ${EM.bg})` }} />
      <button
        type="button"
        aria-label="Scroll down"
        onClick={() => scroller.current?.scrollBy({ top: scroller.current.clientHeight * 0.7, behavior: 'smooth' })}
        className="em-fade absolute bottom-1 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: EM.border, border: '1px solid #3A3A3F', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          {I.arrowDown()}
        </span>
      </button>
    </>
  );
}

/* ---------------------------------------------------- adding a dish ("+") */
/** An order line that can't be served right now (sold out, not at this time, off) — the waiter's warning for it
 *  first, else checked on the phone too, so taps are covered (the same rule as the original theme's tray). */
export function lineWarning(it: CartItem, menuItem: any, warnings: Record<string, CartWarning>, lang: Lang): string | null {
  const w = warnings[cartLineKey(it)];
  if (w) return w.reason;
  const m = menuItem;
  if (!m) return null;
  const soldOut = m.soldOutUntil && new Date(m.soldOutUntil).getTime() > Date.now();
  const outOfHours = Array.isArray(m.availability) && m.availability.length > 0 && !isAvailableAt(m.availability, new Date());
  if (m.available !== false && !soldOut && !outOfHours) return null;
  return (
    m.unavailableReason ||
    (soldOut
      ? tx(lang, 'এই মুহূর্তে শেষ হয়ে গেছে', 'Sold out right now')
      : outOfHours
      ? tx(lang, 'এই সময়ে পাওয়া যায় না', 'Not served at this time')
      : tx(lang, 'এখন পাওয়া যাচ্ছে না', 'Not available right now'))
  );
}

/** The warning under an order line, with "Remove". */
export function LineWarning({ text, lang, onRemove }: { text: string; lang: Lang; onRemove: () => void }) {
  return (
    <div role="alert" className="mt-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: '#2A1A0C', color: '#F6C27A' }}>
      <span aria-hidden="true">⚠</span>
      <span className="flex-1">{text}</span>
      <button type="button" onClick={onRemove} className="h-8 shrink-0 font-semibold underline">
        {tx(lang, 'বাদ দিন', 'Remove')}
      </button>
    </div>
  );
}

export function needsChoices(item: any): boolean {
  return (Array.isArray(item?.variations) && item.variations.length > 1) || (Array.isArray(item?.modifierGroups) && item.modifierGroups.length > 0);
}
export function priceOf(item: any): number {
  if (typeof item?.price === 'number' && item.price > 0) return item.price;
  const vs = Array.isArray(item?.variations) ? item.variations.map((v: any) => v?.price).filter((p: any) => typeof p === 'number') : [];
  return vs.length ? Math.min(...vs) : typeof item?.price === 'number' ? item.price : 0;
}
export const imageOf = (item: any): string | undefined =>
  (Array.isArray(item?.media) && item.media.find(Boolean)) || item?.imageUrl || item?.image || undefined;
export function haptic() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* unsupported */
  }
}

/** The corner "+" on a dish photo → an amber "− 1 +" pill (a trash can at 1). Dishes with sizes / add-ons open
 *  their choices first. `wide`: the pill spans the photo (menu rows). */
/** Within this long of ordering a dish (still on its way), "+" on it asks first. */
export const DUPLICATE_MS = 20 * 60 * 1000;

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "You ordered Hot Wings at 7:40 — it's on its way. Add another?" */
export function AgainSheet({ lang, name, at, onYes, onNo }: { lang: Lang; name: string; at: number; onYes: () => void; onNo: () => void }) {
  const time = clockText(hhmm(at), lang);
  return (
    <Sheet open onClose={onNo} label={tx(lang, 'আরেকটা যোগ করবেন?', 'Add another?')}>
      <div className="flex flex-col gap-4 pb-1">
        <p className="em-tight text-[21px] font-medium leading-[1.3]">
          {lang === 'en' ? (
            <>
              You ordered <span style={{ color: EM.amber }}>{name}</span> at {time}. It's on its way.{' '}
              <span style={{ color: EM.muted }}>Add another?</span>
            </>
          ) : (
            <>
              {time}-এ <span style={{ color: EM.amber }}>{name}</span> অর্ডার করেছেন, এখনো আসছে।{' '}
              <span style={{ color: EM.muted }}>আরেকটা যোগ করব?</span>
            </>
          )}
        </p>
        <div className="flex gap-2.5">
          <button type="button" onClick={onYes} className="h-12 flex-1 rounded-full text-[15px] font-bold" style={{ background: EM.amber, color: EM.bg }}>
            {tx(lang, 'হ্যাঁ, আরেকটা', 'Yes, one more')}
          </button>
          <button type="button" onClick={onNo} className="h-12 flex-1 rounded-full text-[15px] font-semibold" style={{ background: EM.surface2, color: EM.text }}>
            {tx(lang, 'না', 'No')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function AddControl({
  item,
  onChoose,
  disabled,
  onAdded,
  wide = false,
  lang = 'bn',
}: {
  item: { id: string; name: string; price: number; imageUrl?: string; choices?: boolean };
  onChoose?: () => void;
  disabled?: boolean;
  onAdded?: () => void;
  wide?: boolean;
  lang?: Lang;
}) {
  const { items, addItem, setQty } = useCart();
  // ordered already and still on its way → ask once before a second one (the first may just not be here yet)
  const visit = useVisit();
  const sentAt = visit.onTheWay[item.id];
  const [ask, setAsk] = useState(false);
  // the plain line of this dish (no size / add-ons) is what "+" and "−" change; with sizes, all its lines count
  const plain = items.find((it) => it.id === item.id && !it.variation && !(it.modifiers && it.modifiers.length));
  const all = items.filter((it) => it.id === item.id).reduce((n, it) => n + it.qty, 0);
  const qty = item.choices ? all : plain?.qty ?? 0;
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const plus = (e: React.MouseEvent) => {
    stop(e);
    if (disabled) return;
    if (qty === 0 && sentAt && Date.now() - sentAt < DUPLICATE_MS) return setAsk(true);
    add();
  };
  const add = () => {
    haptic();
    onAdded?.();
    if (item.choices) return onChoose?.();
    if (!plain) addItem({ id: item.id, name: item.name, price: item.price, ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}) });
    else setQty(item.id, plain.qty + 1);
  };
  const askSheet =
    ask && typeof document !== 'undefined'
      ? createPortal(
          <AgainSheet
            lang={lang}
            name={item.name}
            at={sentAt}
            onYes={() => {
              setAsk(false);
              add();
            }}
            onNo={() => setAsk(false)}
          />,
          document.body,
        )
      : null;
  const minus = (e: React.MouseEvent) => {
    stop(e);
    if (item.choices) return onChoose?.();
    setQty(item.id, qty - 1);
  };
  if (qty === 0)
    return (
      <>
      {askSheet}
      <button
        type="button"
        aria-label={`Add ${item.name}`}
        disabled={disabled}
        onClick={plus}
        className="absolute bottom-0.5 right-0.5 flex h-11 w-11 items-center justify-center disabled:opacity-40"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: EM.text, color: EM.bg, boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}>
          {I.plus()}
        </span>
      </button>
      </>
    );
  return (
    <div
      onClick={stop}
      className={`em-fade absolute flex items-center justify-between rounded-full ${wide ? 'bottom-1.5 left-1.5 right-1.5 h-8' : 'bottom-2.5 right-2.5 h-9 w-[124px]'}`}
      style={{ background: EM.amber, color: EM.bg, boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
    >
      <button type="button" aria-label={qty === 1 ? `Remove ${item.name}` : `One less ${item.name}`} onClick={minus} className="flex h-full w-10 items-center justify-center">
        {qty === 1 ? I.trash() : I.minus({ size: 16 })}
      </button>
      <span className="text-[15px] font-bold tabular-nums" aria-live="polite">{qty}</span>
      <button type="button" aria-label={`Add one more ${item.name}`} disabled={disabled} onClick={plus} className="flex h-full w-10 items-center justify-center">
        {I.plus()}
      </button>
    </div>
  );
}

/** A dish's sizes and add-ons, picked before it goes in the order. */
export function DishSheet({
  item,
  onClose,
  lang,
  onAdded,
  line,
}: {
  item: any | null;
  onClose: () => void;
  lang: Lang;
  onAdded?: () => void;
  /** an order line being changed (tapped in the order): its size / choices / qty preset, saved in its place */
  line?: CartItem | null;
}) {
  const { addItem, replaceLine, removeLine } = useCart();
  const variations: Array<{ name: string; price?: number }> = Array.isArray(item?.variations) ? item.variations : [];
  const groups: ModifierGroup[] = (Array.isArray(item?.modifierGroups) ? item.modifierGroups : []).map((g: any) => ({
    id: String(g.id),
    name: String(g.name),
    min: Number(g.min) || 0,
    max: Number(g.max) || 1,
    options: (g.options || []).map((o: any) => ({ id: String(o.id ?? o.name), name: String(o.name), price: Number(o.price) || 0 })),
  }));
  const [size, setSize] = useState<string>('');
  const [picks, setPicks] = useState<ModifierPicks>({});
  const [qty, setQtyState] = useState(1);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setSize(line?.variation || (variations.length > 1 ? '' : variations[0]?.name ?? ''));
    const pre: ModifierPicks = {};
    for (const m of line?.modifiers ?? []) (pre[m.groupId] ??= []).push(m.optionId);
    setPicks(pre);
    setQtyState(line?.qty ?? 1);
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, line ? cartLineKey(line) : '']);
  if (!item) return null;
  const base = variations.find((v) => v.name === size)?.price ?? priceOf(item);
  const mods: CartModifier[] = picksToModifiers(groups, picks);
  const unit = base + mods.reduce((n, m) => n + m.price, 0);
  const errors = validatePicks(groups, picks);
  const sizeMissing = variations.length > 1 && !size;
  const ok = !sizeMissing && !Object.keys(errors).length;
  const toggle = (g: ModifierGroup, id: string) =>
    setPicks((p) => {
      const cur = p[g.id] ?? [];
      if (g.max === 1) return { ...p, [g.id]: cur[0] === id ? [] : [id] };
      return { ...p, [g.id]: cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < g.max ? [...cur, id] : cur };
    });
  // sizes: a 2-column grid, each with its price; choices: pills (the design, sheet D)
  const sizeCell = (v: { name: string; price?: number }) => {
    const on = size === v.name;
    return (
      <button
        key={v.name}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setSize(v.name)}
        className="flex h-[52px] flex-col items-center justify-center gap-px rounded-[14px] transition active:scale-[0.98]"
        style={{ border: on ? `1.5px solid ${EM.amber}` : `1px solid ${EM.border}`, background: on ? EM.amberTint : EM.surface2 }}
      >
        <span className="text-[15px] font-semibold">{v.name}</span>
        {typeof v.price === "number" && <span className="text-[12px]" style={{ color: on ? EM.amber : EM.text3 }}>{money(v.price)}</span>}
      </button>
    );
  };
  const pill = (key: string, label: string, price: number, on: boolean, onClick: () => void, radio: boolean) => (
    <button
      key={key}
      type="button"
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      onClick={onClick}
      className="flex h-10 items-center gap-[5px] rounded-full text-[14px] transition active:scale-95"
      style={
        on
          ? { background: EM.amber, color: EM.bg, fontWeight: 700, padding: "0 16px 0 12px" }
          : { border: `1px solid ${EM.chipLine}`, background: EM.chip, color: EM.text, fontWeight: 500, padding: "0 16px" }
      }
    >
      {on && I.check({ size: 14, sw: 3 })}
      {label}
      {price > 0 && <span style={{ color: on ? "rgba(11,11,12,0.7)" : EM.text3, fontWeight: 500 }}>+{money(price)}</span>}
    </button>
  );
  return (
    <Sheet open={!!item} onClose={onClose} label={item.name}>
      <div className="flex flex-col gap-4">
        {imageOf(item) && <img src={imageOf(item)} alt="" className="h-44 w-full rounded-[18px] object-cover" />}
        <div>
          <h2 className="em-tight text-[22px] font-semibold">{item.name}</h2>
          {item.description && <p className="mt-1 text-[14px] leading-snug" style={{ color: EM.text3 }}>{item.description}</p>}
        </div>
        {variations.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold" style={{ color: tried && sizeMissing ? EM.danger : EM.text3 }}>
              {tx(lang, 'সাইজ বেছে নিন', 'Choose a size')}
            </span>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">{variations.map(sizeCell)}</div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold" style={{ color: tried && errors[g.id] ? EM.danger : EM.text3 }}>
              {g.name} · {g.min > 0 ? tx(lang, 'আবশ্যক', 'Required') : tx(lang, 'ঐচ্ছিক', 'Optional')}
              {g.max > 1 ? ` · ${tx(lang, `সর্বোচ্চ ${g.max}`, `up to ${g.max}`)}` : ''}
            </span>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => pill(o.id, o.name, o.price, (picks[g.id] ?? []).includes(o.id), () => toggle(g, o.id), g.max === 1))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex h-[52px] items-center rounded-full" style={{ background: EM.surface2 }}>
            <button type="button" aria-label="One less" onClick={() => setQtyState((q) => Math.max(1, q - 1))} className="flex h-full w-12 items-center justify-center">{I.minus()}</button>
            <span className="min-w-[20px] text-center text-[16px] font-semibold">{qty}</span>
            <button type="button" aria-label="One more" onClick={() => setQtyState((q) => q + 1)} className="flex h-full w-12 items-center justify-center">{I.plus({ size: 14 })}</button>
          </div>
          <button
            type="button"
            onClick={() => {
              setTried(true);
              if (!ok) return;
              haptic();
              const next: CartItem = {
                id: String(item.id),
                name: String(item.name),
                price: unit,
                qty,
                ...(variations.length > 1 && size ? { variation: size } : {}),
                ...(mods.length ? { modifiers: mods } : {}),
                ...(imageOf(item) ? { imageUrl: imageOf(item) } : {}),
                ...(line?.notes ? { notes: line.notes } : {}),
              };
              if (line) replaceLine(cartLineKey(line), next);
              else addItem(next);
              onAdded?.();
              onClose();
            }}
            className="h-[52px] flex-1 rounded-full text-[16px] font-bold"
            style={{ background: EM.amber, color: EM.bg, opacity: ok ? 1 : 0.6 }}
          >
            {line ? tx(lang, 'আপডেট করুন', 'Update') : tx(lang, 'যোগ করুন', 'Add')} · {money(unit * qty)}
          </button>
        </div>
        {line && (
          <button
            type="button"
            onClick={() => {
              removeLine(cartLineKey(line));
              onClose();
            }}
            className="h-11 self-center text-[14px] font-semibold"
            style={{ color: EM.danger }}
          >
            {tx(lang, 'অর্ডার থেকে বাদ দিন', 'Remove from order')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ captions (the colouring: captions.ts) */
export { captionSpans } from './captions';
type Span = import('./captions').Span;

/** One caption, coloured (see captionSpans). */
export function Caption({ spans, className, style }: { spans: Span[]; className?: string; style?: React.CSSProperties }) {
  return (
    <p className={className} style={style}>
      {spans.map((s, i) => (
        <span key={i} style={{ color: s.color, transition: 'color 160ms ease-out' }}>
          {s.text}
        </span>
      ))}
    </p>
  );
}

/** A caption that never grows past `lines` lines (the design's rule for long replies): the newest words stay in
 *  view at the bottom, older lines move up and fade out at the top. When there's more than fits, a tap opens the
 *  whole reply (Type mode). */
export function CaptionWindow({
  children,
  lines,
  lineHeight,
  onOpen,
  label,
}: {
  children: React.ReactNode;
  lines: number;
  /** px — the caption's line height */
  lineHeight: number;
  onOpen?: () => void;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });
  const max = Math.round(lines * lineHeight);
  const fade = over ? 'linear-gradient(transparent, #000 ' + Math.round(lineHeight * 0.9) + 'px)' : undefined;
  const body = (
    <div
      ref={box}
      className="flex flex-col justify-end overflow-hidden"
      style={{ maxHeight: max, WebkitMaskImage: fade, maskImage: fade, transition: 'max-height 200ms ease-out' }}
    >
      <div className="shrink-0">{children}</div>
    </div>
  );
  if (!over || !onOpen) return body;
  return (
    <button type="button" onClick={onOpen} aria-label={label} className="block w-full text-left">
      {body}
    </button>
  );
}

/** The guest's words while they talk: what was there already in white, the newest guess in grey. */
export function useLiveHeard(live: string): Span[] {
  const prev = useRef('');
  const [stable, setStable] = useState('');
  useEffect(() => {
    if (!live) {
      prev.current = '';
      setStable('');
      return;
    }
    // the part that was already showing is "confirmed enough"; what this update added is the newest guess
    setStable(live.startsWith(prev.current) ? prev.current : '');
    prev.current = live;
  }, [live]);
  if (!live) return [];
  const fresh = live.slice(stable.length);
  return [
    ...(stable ? [{ text: stable, color: EM.text }] : []),
    ...(fresh ? [{ text: fresh, color: EM.muted }] : []),
  ];
}

/** "Good evening." by the guest's clock. */
export function greeting(lang: Lang, at = new Date()): string {
  const h = at.getHours();
  if (lang === 'bn') return h < 12 ? 'শুভ সকাল।' : h < 17 ? 'শুভ দুপুর।' : 'শুভ সন্ধ্যা।';
  return h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
}
