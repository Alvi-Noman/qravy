// apps/braincell/src/components/digital-menu/RestaurantApp.tsx — Digital Menu → "Your restaurant's app". Guests add the
// restaurant's online shop to their phone's home screen (a PWA: Android and iPhone, no store, no download file), from
// a QR card on the tables / bags, a shared link, or the offer after a meal or an online order (Ember theme). Here the
// owner sees what it is, gets the share kit (link, WhatsApp, QR as PNG / SVG, a printable table card) and how it's
// doing. The app is made from Branding (logo, name) — nothing to set up. Only for restaurants that sell online.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DevicePhoneMobileIcon,
  LinkIcon,
  PrinterIcon,
  QrCodeIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import api from '../../api/auth';
import { storefrontBase } from '../../utils/storefront';
import { toastError, toastSuccess } from '../Toaster';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || (typeof window !== 'undefined' ? window.location.origin : '');

type Stats = {
  pageViews: { total: number; card: number; link: number; offer: number };
  installsAndroid: number;
  iphoneGuides: number;
  opens: number;
  openPhones: number;
};

type TenantLike = {
  name?: string;
  subdomain?: string;
  guestDomain?: string | null;
  logoUrl?: string | null;
  restaurantInfo?: { onlineSalesEnabled?: boolean };
};

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-[#ececf0] bg-white px-4 py-3">
      <span className="text-[12px] font-medium text-slate-500">{label}</span>
      <span className="text-[22px] font-semibold tabular-nums text-slate-900">{value}</span>
      {hint && <span className="text-[11.5px] text-slate-400">{hint}</span>}
    </div>
  );
}

function Way({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-[#ececf0] bg-white p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700">{icon}</span>
      <span className="text-[14px] font-semibold text-slate-900">{title}</span>
      <span className="text-[13px] leading-relaxed text-slate-600">{children}</span>
    </div>
  );
}

/** The home screen with the restaurant's icon among others — what guests end up with. */
function HomeScreen({ icon, name }: { icon: string; name: string }) {
  const short = name.length > 12 ? `${name.slice(0, 11)}…` : name;
  return (
    <div aria-hidden="true" className="relative mx-auto h-[300px] w-[170px] shrink-0 overflow-hidden rounded-[30px] border-[6px] border-[#1f1f22] bg-gradient-to-b from-[#1E3A5F] to-[#0F1B2D] shadow-xl">
      <div className="grid grid-cols-3 gap-x-3 gap-y-4 px-4 pt-8">
        {['bg-emerald-400/80', 'bg-sky-400/80', 'bg-pink-400/80', 'bg-white/25', null, 'bg-orange-400/80', 'bg-white/25', 'bg-violet-400/80', 'bg-white/25'].map((c, i) =>
          c ? (
            <span key={i} className="flex flex-col items-center gap-1">
              <span className={`h-9 w-9 rounded-[10px] ${c}`} />
              <span className="h-1.5 w-7 rounded bg-white/30" />
            </span>
          ) : (
            <span key={i} className="flex flex-col items-center gap-1">
              <img src={icon} alt="" className="h-9 w-9 rounded-[10px] bg-white ring-2 ring-amber-400 ring-offset-2 ring-offset-[#18304e]" />
              <span className="max-w-[48px] truncate text-[8px] font-medium text-white">{short}</span>
            </span>
          ),
        )}
      </div>
      <div className="absolute inset-x-3 bottom-3 flex justify-around rounded-2xl bg-white/15 py-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-7 w-7 rounded-[9px] bg-white/30" />
        ))}
      </div>
    </div>
  );
}

const FAQ: Array<[string, string]> = [
  ['Is it a real app?', "It's your online shop, installed. It opens full screen from its own icon, like any app. Guests order, talk to your AI waiter and track their order in it."],
  ['Do I have to update it?', 'No. It is your website, so every change you make (menu, prices, theme, logo) is in the app the next time it opens.'],
  ['What about iPhones?', 'Apple has no install button for websites, so iPhone guests get a 3-step guide (Share → Add to Home Screen → Add). The result is the same icon on their home screen.'],
  ['Is it on the Play Store?', 'Not needed: guests install it straight from your site. A Play Store listing is possible later as a separate service.'],
  ['Which page does it open?', 'Always your online shop (delivery and pickup). Never a table, even if a guest installed it while eating in.'],
];

export default function RestaurantApp({ tenant }: { tenant: TenantLike | undefined }) {
  const sub = tenant?.subdomain ?? '';
  const name = tenant?.name || 'Your restaurant';
  const online = tenant?.restaurantInfo?.onlineSalesEnabled !== false;
  const base = sub ? storefrontBase(sub, tenant?.guestDomain) : '';
  const cardLink = `${base}/app?src=card`;
  const shareLink = `${base}/app`;
  const icon = sub ? `${API_BASE}/api/v1/public/app/${encodeURIComponent(sub)}/icon-192.png` : '';
  const pngRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<HTMLDivElement | null>(null);
  const [faq, setFaq] = useState<number | null>(null);

  const stats = useQuery({
    queryKey: ['app-stats', sub],
    queryFn: async () => (await api.get('/api/v1/insights/app', { params: { days: 30 } })).data as Stats,
    enabled: !!sub && online,
    staleTime: 60_000,
  });
  const s = stats.data;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toastSuccess('Link copied — paste it in WhatsApp, Facebook or Instagram');
    } catch {
      toastError(shareLink);
    }
  };
  const download = (href: string, file: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = file;
    a.click();
  };
  const downloadPng = () => {
    const canvas = pngRef.current?.querySelector('canvas');
    if (canvas) download(canvas.toDataURL('image/png'), `${sub}-app-qr.png`);
  };
  const downloadSvg = () => {
    const svg = svgRef.current?.querySelector('svg');
    if (svg) download(URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' })), `${sub}-app-qr.svg`);
  };
  const printCard = () => {
    const svg = svgRef.current?.querySelector('svg')?.outerHTML ?? '';
    const w = window.open('', '_blank', 'width=520,height=720');
    if (!w) return toastError('Allow pop-ups to print the card');
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — app card</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&family=Noto+Sans+Bengali:wght@600;700&display=swap" rel="stylesheet">
<style>@page{size:A6;margin:0}body{margin:0;font-family:Inter,'Noto Sans Bengali',sans-serif;display:flex;justify-content:center}
.card{width:105mm;height:148mm;box-sizing:border-box;padding:10mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center}
.icon{width:22mm;height:22mm;border-radius:6mm}.name{font-size:20pt;font-weight:800;margin-top:3mm}.bn{font-size:15pt;font-weight:700;margin-top:2mm}
.en{font-size:10.5pt;color:#555;margin-top:1mm}.qr svg{width:52mm;height:52mm}.url{font-size:8.5pt;color:#777;word-break:break-all}</style></head>
<body><div class="card"><div style="display:flex;flex-direction:column;align-items:center"><img class="icon" src="${icon.replace('icon-192', 'icon-512')}"><div class="name">${esc(name)}</div>
<div class="bn">স্ক্যান করুন, অ্যাপটা নিন</div><div class="en">Scan to get our app — order and talk to our waiter from home</div></div>
<div class="qr">${svg}</div><div class="url">${esc(shareLink.replace(/^https?:\/\//, ''))}</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
    w.document.close();
  };

  const kit = useMemo(
    () => (
      <>
        {/* (hidden: the QR codes the downloads and the printed card are made from) */}
        <div ref={pngRef} className="hidden">
          <QRCodeCanvas value={cardLink} size={1024} level="M" marginSize={2} />
        </div>
        <div ref={svgRef} className="hidden">
          <QRCodeSVG value={cardLink} size={512} level="M" marginSize={1} />
        </div>
      </>
    ),
    [cardLink],
  );

  return (
    <section aria-labelledby="restaurant-app" className="mt-8 overflow-hidden rounded-2xl border border-[#ececec] bg-white shadow-sm">
      <div className="flex flex-col gap-6 bg-gradient-to-br from-amber-50/70 via-white to-white p-6 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="restaurant-app" className="flex items-center gap-2 text-[17px] font-semibold text-slate-900">
              <DevicePhoneMobileIcon className="h-5 w-5 text-slate-600" />
              Your restaurant&apos;s app
            </h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Android & iPhone · included</span>
          </div>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-slate-600">
            Guests can put <b className="text-slate-800">{name}</b> on their phone&apos;s home screen, with your logo, and order from home in one tap. They
            can also talk to your AI waiter and track their delivery. There&apos;s no store and no download file: they install it straight from your
            online shop.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-slate-700">
            {['Made from your logo and name in Branding. Nothing to set up', 'Always up to date: it is your live online shop', 'Your web shop keeps working for everyone else'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-600" />
                {t}
              </li>
            ))}
          </ul>
          {!tenant?.logoUrl && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 ring-1 ring-amber-200">
              Tip: add your logo in <Link to="/settings/branding" className="font-semibold underline">Branding</Link> — the app icon uses your
              initials until then.
            </p>
          )}
        </div>
        {sub && <HomeScreen icon={icon} name={name} />}
      </div>

      {!online ? (
        <div className="border-t border-[#f0f0f0] p-6 text-[14px] text-slate-600">
          Your app opens your online shop, so it needs online ordering. Turn on <b>online sales</b> in{' '}
          <Link to="/settings/operations" className="font-semibold text-slate-900 underline">
            Settings → Operations
          </Link>{' '}
          and it&apos;s ready.
        </div>
      ) : (
        <>
          <div className="border-t border-[#f0f0f0] p-6">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">How guests get it</h3>
            <div className="mt-3 flex flex-col gap-3 md:flex-row">
              <Way icon={<QrCodeIcon className="h-5 w-5" />} title="A QR card on tables and bags">
                Guests scan it with their camera. Their phone shows the right way to install: one tap on Android, three on iPhone.
              </Way>
              <Way icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />} title="Your link on WhatsApp & Facebook">
                Share the link below. If a guest opens it inside WhatsApp or Facebook, the page first helps them open it in Chrome or Safari.
              </Way>
              <Way icon={<SparklesIcon className="h-5 w-5" />} title="Offered at the right moment">
                After a meal is served, or after an online order, guests see a small &quot;get our app&quot; card. Once, never while they order.
              </Way>
            </div>
          </div>

          <div className="grid gap-6 border-t border-[#f0f0f0] p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Share kit</h3>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#e6e6ea] bg-slate-50 px-3 py-2">
                <LinkIcon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-800">{shareLink.replace(/^https?:\/\//, '')}</span>
                <button type="button" onClick={() => void copy()} className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[12.5px] font-semibold text-slate-800 ring-1 ring-[#e2e2e6]">
                  Copy
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Get the ${name} app: order and talk to our waiter from your home screen.\n${shareLink}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#E7F7EE] px-3.5 py-2 text-[13px] font-semibold text-[#11703F] ring-1 ring-[#BFE6CF]"
                >
                  <ChatBubbleLeftRightIcon className="h-4 w-4" />
                  Share on WhatsApp
                </a>
                <button type="button" onClick={printCard} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white">
                  <PrinterIcon className="h-4 w-4" />
                  Print table card
                </button>
                <button type="button" onClick={downloadPng} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e2e6] bg-white px-3.5 py-2 text-[13px] font-medium text-slate-800">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  QR (PNG)
                </button>
                <button type="button" onClick={downloadSvg} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e2e6] bg-white px-3.5 py-2 text-[13px] font-medium text-slate-800">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  QR (SVG, for printers)
                </button>
                <a href={shareLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-900">
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  See what guests see
                </a>
              </div>
              <p className="mt-2 text-[12px] text-slate-500">The QR code on cards opens the same page, marked as a card scan in the numbers below.</p>
            </div>
            <div className="flex flex-col items-center gap-2 self-start rounded-xl border border-[#ececf0] bg-white p-4">
              <QRCodeSVG value={cardLink} size={132} level="M" marginSize={0} />
              <span className="text-[11.5px] text-slate-500">Scan to try it</span>
            </div>
          </div>

          <div className="border-t border-[#f0f0f0] p-6">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Last 30 days</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Install page opened"
                value={s ? s.pageViews.total : '—'}
                hint={s ? `${s.pageViews.card} card · ${s.pageViews.link} link · ${s.pageViews.offer} offer` : undefined}
              />
              <Stat label="Installed on Android" value={s ? s.installsAndroid : '—'} hint="Android tells us" />
              <Stat label="iPhone guests shown how" value={s ? s.iphoneGuides : '—'} hint="iPhones don't report installs" />
              <Stat label="Opened from home screen" value={s ? s.opens : '—'} hint={s ? `on ${s.openPhones} phone${s.openPhones === 1 ? '' : 's'}` : undefined} />
            </div>
          </div>

          <div className="border-t border-[#f0f0f0] p-6">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Questions</h3>
            <div className="mt-2 divide-y divide-[#f0f0f0]">
              {FAQ.map(([q, a], i) => (
                <div key={q}>
                  <button type="button" onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i} className="flex w-full items-center justify-between gap-3 py-3 text-left text-[14px] font-medium text-slate-800">
                    {q}
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${faq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {faq === i && <p className="pb-3 text-[13.5px] leading-relaxed text-slate-600">{a}</p>}
                </div>
              ))}
            </div>
          </div>
          {kit}
        </>
      )}
    </section>
  );
}
