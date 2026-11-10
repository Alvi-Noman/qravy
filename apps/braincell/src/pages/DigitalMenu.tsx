// apps/braincell/src/pages/DigitalMenu.tsx — Digital Menu → Themes: how the restaurant's guest site looks.
// Like a shop's theme library: the theme guests see now (with a live preview), the other themes (preview any of them
// on the real site, then publish). A theme is only the look — the menu, the AI waiter, ordering and checkout are the
// same in every theme. The guest site follows the saved theme at once (tenant.storefrontTheme).
//   Ember — dark, voice-first (the default for new restaurants)
//   Petal — the original light look (restaurants from before themes keep it until they switch)
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  DevicePhoneMobileIcon,
  EyeIcon,
  PaintBrushIcon,
  QrCodeIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTenant } from '../hooks/useTenant';
import { updateTenant } from '../api/tenant';
import { useAuthContext } from '../context/AuthContext';
import { toastError, toastSuccess } from '../components/Toaster';
import { onlineUrl, storefrontBase, tableUrl } from '../utils/storefront';

export type ThemeId = 'ember' | 'petal';

type ThemeInfo = {
  id: ThemeId;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  badge?: string;
  swatches: string[];
};

export const THEMES: ThemeInfo[] = [
  {
    id: 'ember',
    name: 'Ember',
    tagline: 'Dark, voice-first',
    description:
      'A calm dark look built around the AI waiter. The mic sits at the bottom of every screen, the menu stays in focus while guests talk, and suggestions appear right inside the order.',
    features: [
      'Mic always bottom-centre: Menu · Talk · Type',
      'Suggestions inside the order, one tap to add',
      'Talk on the menu: captions without covering dishes',
      'Live order status with a countdown ring',
      'One-page checkout for delivery and pickup',
    ],
    badge: 'Default',
    swatches: ['#0B0B0C', '#151517', '#F5A524', '#F5F5F7'],
  },
  {
    id: 'petal',
    name: 'Petal',
    tagline: 'Light and friendly',
    description:
      'The original Qravy look: a bright, soft-pink site with the AI waiter’s orb in the middle of the home screen and the menu as a grid of cards.',
    features: [
      'Large orb on the home screen: tap or hold to talk',
      'Waiter’s suggestions in a full-screen sheet',
      'Menu as cards with categories and search',
      'Tray with the waiter’s picks and offers',
    ],
    badge: 'Classic',
    swatches: ['#FFF8FA', '#FFFFFF', '#FA2851', '#1F1F1F'],
  },
];

const themeOf = (v: unknown): ThemeId => (v === 'ember' ? 'ember' : 'petal');

/* ---------------------------------------------------------------- thumbnails
   A small drawing of each theme's home screen (no network, instant). The real site is in the live preview. */
function EmberThumb({ name }: { name: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#0B0B0C', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="absolute -bottom-[45%] left-1/2 h-[90%] w-[130%] -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(245,165,36,0.32), rgba(245,165,36,0.06) 60%, rgba(245,165,36,0))' }} />
      <div className="absolute right-[6%] top-[5%] flex gap-[3%]" style={{ width: '58%' }}>
        <div className="aspect-square w-[24%] rounded-full border border-[#2C2C30] bg-[#151517]" />
        <div className="flex-1 rounded-full border border-[#4A3A1E] bg-[#1B160E]" />
      </div>
      <div className="absolute left-[8%] right-[8%] top-[19%] flex flex-col gap-[6%]">
        <div className="font-medium leading-none text-[#F5F5F7]" style={{ fontSize: '11cqw' }}>
          Good evening.
        </div>
        <div className="leading-tight text-[#D1D1D6]" style={{ fontSize: '5.6cqw' }}>
          I'm Pixie, your waiter at {name}. Hungry, or starting with drinks?
        </div>
      </div>
      <div className="absolute left-[7%] right-[7%] top-[60%] flex flex-wrap gap-[3%]">
        {[44, 30, 36, 26].map((w, i) => (
          <div key={i} className="mb-[3%] rounded-full border border-[#3A3226] bg-[#17140F]" style={{ width: `${w}%`, height: '6cqw' }} />
        ))}
      </div>
      <div className="absolute bottom-[5%] left-0 right-0 flex items-end justify-center gap-[10%]">
        <div className="aspect-square w-[14%] rounded-full border border-[#2C2C30] bg-[#151517]" />
        <div className="aspect-square w-[23%] rounded-full" style={{ background: 'radial-gradient(circle at 34% 28%, #FFF1D6, #F5A524 48%, #8A3E08)', boxShadow: '0 0 30px 4px rgba(245,165,36,0.35)' }} />
        <div className="aspect-square w-[14%] rounded-full border border-[#2C2C30] bg-[#151517]" />
      </div>
    </div>
  );
}

function PetalThumb({ name }: { name: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#FFF8FA', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="absolute right-[6%] top-[5%] h-[5%] w-[18%] rounded-full bg-white shadow-sm ring-1 ring-[#FA2851]/10" />
      <div className="absolute left-[6%] top-[5%] h-[5%] w-[30%] rounded-full bg-white shadow-sm ring-1 ring-[#FA2851]/10" />
      <div
        className="absolute left-1/2 top-[18%] aspect-square w-[46%] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, #FFD9E1, #FF7A95 55%, #FA2851)', boxShadow: '0 12px 40px rgba(250,40,81,0.35)' }}
      />
      <div className="absolute left-[10%] right-[10%] top-[62%] text-center font-semibold leading-tight text-[#1F1F1F]" style={{ fontSize: '5.4cqw' }}>
        Welcome to {name}! I'm Pixie, your virtual waiter.
      </div>
      <div className="absolute bottom-[6%] left-[8%] right-[8%] grid grid-cols-2 gap-[4%]">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center gap-[10%] rounded-[14px] bg-white py-[5%] shadow-[0_8px_24px_rgba(250,40,81,0.10)] ring-1 ring-[#FA2851]/10">
            <div className="aspect-square w-[26%] rounded-full bg-gradient-to-br from-[#FFD4DA] to-[#FFE9ED]" />
            <div className="h-[6px] w-[50%] rounded bg-[#1F1F1F]/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Thumb({ id, name, className = '' }: { id: ThemeId; name: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[22px] border-[5px] border-[#111] bg-black shadow-xl ${className}`} style={{ aspectRatio: '390 / 844', containerType: 'inline-size' }}>
      {id === 'ember' ? <EmberThumb name={name} /> : <PetalThumb name={name} />}
    </div>
  );
}

/* ------------------------------------------------------------- live preview */
type Device = 'phone' | 'desktop';
type Side = 'online' | 'dine-in';

function PreviewModal({
  theme,
  current,
  urls,
  onClose,
  onPublish,
  publishing,
}: {
  theme: ThemeInfo;
  current: boolean;
  urls: { online: string | null; dineIn: string | null };
  onClose: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const [device, setDevice] = useState<Device>('phone');
  const [side, setSide] = useState<Side>(urls.dineIn && !urls.online ? 'dine-in' : 'online');
  const [reloadKey, setReloadKey] = useState(0);
  const base = side === 'dine-in' ? urls.dineIn : urls.online;
  // the site, on this theme for this preview tab only (real guests keep the published theme)
  const src = base ? `${base}${base.includes('?') ? '&' : '?'}theme=${theme.id}` : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const seg = (on: boolean) => `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-[#f4f4f5]" role="dialog" aria-label={`Preview ${theme.name}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e5e5] bg-white px-4 py-2.5">
        <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <XMarkIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-slate-900">
            {theme.name} {current && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Live</span>}
          </div>
          <div className="text-[12px] text-slate-500">Preview · only you see this</div>
        </div>
        <div className="mx-auto flex items-center gap-2">
          {urls.online && urls.dineIn && (
            <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Which guests">
              <button type="button" className={seg(side === 'online')} onClick={() => setSide('online')}>Online</button>
              <button type="button" className={seg(side === 'dine-in')} onClick={() => setSide('dine-in')}>Dine-in</button>
            </div>
          )}
          <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Device">
            <button type="button" className={seg(device === 'phone')} onClick={() => setDevice('phone')} aria-label="Phone">
              <DevicePhoneMobileIcon className="h-4 w-4" />
            </button>
            <button type="button" className={seg(device === 'desktop')} onClick={() => setDevice('desktop')} aria-label="Desktop">
              <ComputerDesktopIcon className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-md px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100">
            Restart
          </button>
        </div>
        <div className="flex items-center gap-2">
          {src && (
            <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
              Open in new tab <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {current ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
              <CheckCircleIcon className="h-4 w-4" /> Published
            </span>
          ) : (
            <button type="button" disabled={publishing} onClick={onPublish} className="rounded-md bg-slate-900 px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
              {publishing ? 'Publishing…' : `Publish ${theme.name}`}
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {!src ? (
          <p className="max-w-sm text-center text-sm text-slate-500">Your site address isn’t set up yet, so there’s nothing to preview.</p>
        ) : device === 'phone' ? (
          <div className="relative rounded-[48px] border-[10px] border-[#111] bg-black shadow-2xl" style={{ width: 410, height: 'min(864px, calc(100dvh - 120px))' }}>
            <div className="absolute left-1/2 top-2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-black" />
            <iframe key={`${src}-${reloadKey}`} title={`${theme.name} preview`} src={src} className="h-full w-full rounded-[38px] bg-white" allow="microphone; autoplay" />
          </div>
        ) : (
          <div className="flex h-full w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-[#ddd] bg-white shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-[#eee] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 truncate rounded-md bg-slate-100 px-3 py-1 text-[12px] text-slate-500">{base}</span>
            </div>
            <iframe key={`${src}-${reloadKey}`} title={`${theme.name} preview`} src={src} className="min-h-0 w-full flex-1" allow="microphone; autoplay" />
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the page */
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#ececec] bg-white shadow-sm ${className}`}>{children}</section>;
}

export default function DigitalMenuPage(): JSX.Element {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const { data: tenant, isLoading } = useTenant();
  const [previewing, setPreviewing] = useState<ThemeId | null>(null);
  const [confirming, setConfirming] = useState<ThemeId | null>(null);
  const [publishing, setPublishing] = useState(false);

  const live = themeOf(tenant?.storefrontTheme);
  const liveTheme = THEMES.find((t) => t.id === live)!;
  const others = THEMES.filter((t) => t.id !== live);
  const name = tenant?.name || 'your restaurant';

  const urls = useMemo(() => {
    if (!tenant?.subdomain) return { online: null, dineIn: null };
    const base = storefrontBase(tenant.subdomain, tenant.guestDomain);
    const dineInOn = !!tenant.restaurantInfo?.dineInEnabled;
    const onlineOn = tenant.restaurantInfo?.onlineSalesEnabled !== false;
    const firstTable = tenant.tables?.[0];
    return {
      online: onlineOn ? onlineUrl(base) : null,
      // a real table, so the preview opens the table's page (no table yet → the online site only)
      dineIn: dineInOn && firstTable ? tableUrl(base, firstTable, tenant.tableKeys?.[firstTable]) : null,
    };
  }, [tenant]);

  const publish = async (id: ThemeId) => {
    if (!token) return;
    setPublishing(true);
    try {
      await updateTenant({ storefrontTheme: id }, token);
      await queryClient.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess(`${THEMES.find((t) => t.id === id)?.name} is live — guests see it now`);
      setConfirming(null);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not publish the theme');
    } finally {
      setPublishing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2e2e30] border-t-transparent" />
      </div>
    );
  }

  const previewTheme = THEMES.find((t) => t.id === previewing);
  const confirmTheme = THEMES.find((t) => t.id === confirming);
  const siteUrl = urls.online ?? urls.dineIn;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[18px] font-semibold text-slate-900">
            <PaintBrushIcon className="h-5 w-5 text-slate-600" />
            Digital Menu
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Choose how your guest site looks. Your menu, AI waiter and ordering work the same in every theme.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/qr-codes" className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <QrCodeIcon className="h-4 w-4" /> QR codes
          </Link>
          {siteUrl && (
            <a href={siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              View your site <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {/* the theme guests see now */}
      <Card className="mt-6 overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="flex items-center justify-center gap-5 bg-gradient-to-br from-slate-50 to-slate-100 p-8">
            <Thumb id={live} name={name} className="w-[190px]" />
          </div>
          <div className="flex flex-col p-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Current theme
              </span>
              {liveTheme.badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{liveTheme.badge}</span>}
            </div>
            <h2 className="mt-3 text-[24px] font-semibold tracking-tight text-slate-900">{liveTheme.name}</h2>
            <p className="text-[13px] font-medium text-slate-500">{liveTheme.tagline}</p>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-600">{liveTheme.description}</p>
            <ul className="mt-4 grid gap-1.5 text-[13px] text-slate-700 sm:grid-cols-2">
              {liveTheme.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-1.5">
              {liveTheme.swatches.map((c) => (
                <span key={c} title={c} className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: c }} />
              ))}
            </div>
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              <button type="button" onClick={() => setPreviewing(live)} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                <EyeIcon className="h-4 w-4" /> Preview
              </button>
              <Link to="/settings/branding" className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Logo &amp; name
              </Link>
              <Link to="/settings/ai-waiter" className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <SparklesIcon className="h-4 w-4" /> AI waiter
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* the library */}
      <div className="mt-8">
        <h2 className="text-[15px] font-semibold text-slate-900">Theme library</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">Preview a theme on your real menu before you publish it. Switching is instant and you can switch back any time.</p>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {others.map((t) => (
            <Card key={t.id} className="group flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setPreviewing(t.id)}
                className="relative flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-6"
                aria-label={`Preview ${t.name}`}
              >
                <Thumb id={t.id} name={name} className="w-[140px] transition group-hover:-translate-y-1" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-slate-900 shadow">
                    <EyeIcon className="h-4 w-4" /> Preview
                  </span>
                </span>
              </button>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[16px] font-semibold text-slate-900">{t.name}</h3>
                  {t.badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{t.badge}</span>}
                </div>
                <p className="text-[12px] text-slate-500">{t.tagline}</p>
                <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-slate-600">{t.description}</p>
                <div className="mt-3 flex items-center gap-1.5">
                  {t.swatches.map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-auto flex gap-2 pt-4">
                  <button type="button" onClick={() => setPreviewing(t.id)} className="flex-1 rounded-md border border-[#e5e5e5] px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Preview
                  </button>
                  <button type="button" onClick={() => setConfirming(t.id)} className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                    Publish
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {previewTheme && (
        <PreviewModal
          theme={previewTheme}
          current={previewTheme.id === live}
          urls={urls}
          onClose={() => setPreviewing(null)}
          onPublish={() => setConfirming(previewTheme.id)}
          publishing={publishing}
        />
      )}

      {confirmTheme && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={`Publish ${confirmTheme.name}`}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-[16px] font-semibold text-slate-900">Publish {confirmTheme.name}?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              Guests will see {confirmTheme.name} on your site and table QR codes right away, replacing {liveTheme.name}. Your menu, orders and
              settings don’t change, and you can switch back any time.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-[#e5e5e5] px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={publishing} onClick={() => publish(confirmTheme.id)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
