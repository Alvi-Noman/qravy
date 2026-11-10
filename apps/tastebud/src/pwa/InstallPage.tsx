// apps/tastebud/src/pwa/InstallPage.tsx — /app: the restaurant's app, to install. What the QR card and the shared link
// open. One job: put the restaurant on the guest's home screen. It knows the phone and browser before it draws, and
// shows only what that phone needs:
//   Android, Chrome → one Install button (Android's own install box), then "Installed! Open"
//   iPhone, Safari / Chrome → the 3 taps (Share → Add to Home Screen → Add), pointing at the Share button
//   inside WhatsApp / Facebook / Instagram → open in Chrome (Android, one tap) / Safari (iPhone) first
//   already installed → Open · a computer → the link as a QR code to scan
// "Order in the browser" is always there. The app it installs opens the online shop (never a table).
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { getTenant } from '../api/storefront';
import { storeSubFromPath } from '../utils/table';
import { track } from '../utils/track';
import { appIconHref, chromeIntent, installedBefore, promptInstall, shopHref, siteBase, thisPhone, useInstall, useInstalledApp } from './pwa';
import { branchOfPath } from './AppHead';

type Lang = 'bn' | 'en';
const tx = (lang: Lang, bn: string, en: string) => (lang === 'en' ? en : bn);

const C = { bg: '#0B0B0C', surf: '#161618', line: '#2C2C30', text: '#F5F5F7', muted: '#8E8E93', amber: '#F5A524', tint: '#1B160E' };

function Icon({ src, name, size = 84 }: { src: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <span className="flex items-center justify-center font-bold text-white" style={{ width: size, height: size, borderRadius: size * 0.28, background: '#C8102E', fontSize: size * 0.32 }}>
      {name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
    </span>
  ) : (
    <img src={src} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size * 0.28, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }} />
  );
}

function Perks({ lang }: { lang: Lang }) {
  const rows = [
    tx(lang, 'হোম স্ক্রিন থেকে এক ট্যাপে মেনু আর অর্ডার', 'Menu and ordering, one tap from your home screen'),
    tx(lang, 'আমাদের ওয়েটারের সাথে কথা বলে অর্ডার করুন', 'Talk to our waiter to order'),
    tx(lang, 'আগের অর্ডার আবার এক ট্যাপে, রাইডার কোথায় দেখুন', 'Reorder in one tap, see where your rider is'),
  ];
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] p-4" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
      {rows.map((r) => (
        <div key={r} className="flex items-start gap-2.5 text-[14px] leading-snug">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold" style={{ background: C.tint, color: C.amber }}>
            ✓
          </span>
          {r}
        </div>
      ))}
    </div>
  );
}

function Step({ n, on, children }: { n: number; on: boolean; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl p-3 text-[15px] transition-colors duration-300"
      style={{ background: on ? C.tint : C.surf, border: `1px solid ${on ? C.amber : C.line}` }}
    >
      <b className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] transition-colors duration-300" style={on ? { background: C.amber, color: C.bg } : { background: '#2C2C30' }}>
        {n}
      </b>
      <span>{children}</span>
    </div>
  );
}

const Glyph = ({ children }: { children: React.ReactNode }) => (
  <span className="mx-0.5 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border-[1.6px] px-1 align-[-5px] text-[12px] font-bold">{children}</span>
);

export default function InstallPage() {
  const { pathname, search } = useLocation();
  const sub = storeSubFromPath(pathname);
  const base = siteBase(pathname);
  const branch = branchOfPath(pathname.replace(/\/app\/?$/, ''));
  const home = shopHref(base, branch);
  const { data: info } = useQuery({
    queryKey: ['tenantInfo', sub],
    enabled: Boolean(sub),
    queryFn: async () => ((typeof window !== 'undefined' ? (window as any).__STORE__?.tenant : undefined) ?? (sub ? await getTenant(sub) : null)),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const t = info as { name?: string; waiterLanguage?: string; channels?: { online?: boolean } } | null | undefined;
  const name = t?.name || '';
  const [lang, setLang] = useState<Lang>('bn');
  useEffect(() => {
    if (t?.waiterLanguage === 'en') setLang('en');
  }, [t?.waiterLanguage]);

  // the phone, decided before anything is drawn (what the browser says about itself)
  const phone = useMemo(thisPhone, []);
  const { canPrompt, installedNow } = useInstall();
  const reported = useInstalledApp();
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState(0);
  const source = new URLSearchParams(search).get('src') === 'card' ? 'card' : new URLSearchParams(search).get('src') === 'offer' ? 'offer' : 'link';

  useEffect(() => {
    if (!sub) return;
    track('app_page', { data: { source, kind: phone.inApp ? `${phone.os}-inapp` : phone.os } });
    if (phone.os === 'ios' && !phone.inApp) track('app_install_offered', { data: { source, kind: 'ios' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);
  useEffect(() => {
    document.title = name ? `${name} · ${tx(lang, 'অ্যাপ', 'App')}` : 'App';
  }, [name, lang]);
  // the iPhone steps light up one after another
  useEffect(() => {
    if (phone.os !== 'ios' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % 3), 1600);
    return () => window.clearInterval(id);
  }, [phone.os]);

  const icon = sub ? appIconHref(sub, 512) : '';
  const already = phone.standalone || reported || (installedBefore() && phone.os === 'android' && !canPrompt);
  const noApp = t && t.channels?.online === false;
  const browserLink = (
    <a href={home} className="text-center text-[13px] underline underline-offset-4" style={{ color: C.muted }}>
      {tx(lang, 'ব্রাউজারেই অর্ডার করুন', 'Order in the browser instead')}
    </a>
  );
  const head = (sub2: string) => (
    <div className="mt-2 flex flex-col items-center gap-2.5 text-center">
      {icon && <Icon src={icon} name={name} />}
      <div className="text-[26px] font-bold tracking-[-0.4px]">{name}</div>
      <div className="max-w-[28ch] text-[14px] leading-snug" style={{ color: C.muted }}>
        {sub2}
      </div>
    </div>
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  let body: React.ReactNode;
  if (!t) {
    body = <div className="mt-24 h-24 animate-pulse rounded-3xl" style={{ background: C.surf }} />;
  } else if (noApp) {
    body = (
      <>
        {head(tx(lang, 'এই রেস্টুরেন্টের অ্যাপ এখনো নেই।', "This restaurant doesn't have an app yet."))}
        <div className="flex-1" />
        <a href={home} className="flex h-14 items-center justify-center rounded-full text-[16px] font-extrabold" style={{ background: C.amber, color: C.bg }}>
          {tx(lang, 'মেনু দেখুন', 'See the menu')}
        </a>
      </>
    );
  } else if (already || installedNow) {
    body = (
      <>
        {installedNow ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full text-[30px] font-extrabold text-white" style={{ background: '#1F7A4D' }}>
              ✓
            </span>
            <div className="text-[22px] font-bold">{tx(lang, 'ইনস্টল হয়ে গেছে!', 'Installed!')}</div>
            <div className="text-[14px]" style={{ color: C.muted }}>
              {tx(lang, `${name} এখন আপনার হোম স্ক্রিনে।`, `${name} is on your home screen now.`)}
            </div>
          </div>
        ) : (
          head(tx(lang, 'অ্যাপটা আপনার ফোনে আগে থেকেই আছে', 'You already have the app'))
        )}
        <div className="flex-1" />
        <a href={`${home}?source=homescreen`} className="flex h-14 items-center justify-center rounded-full text-[16px] font-extrabold" style={{ background: C.amber, color: C.bg }}>
          {tx(lang, `${name} খুলুন`, `Open ${name}`)}
        </a>
      </>
    );
  } else if (phone.os === 'android' && phone.inApp) {
    body = (
      <>
        {head(tx(lang, 'অ্যাপটা পেতে আগে Chrome-এ খুলুন', 'Open this in Chrome first to get the app'))}
        <a href={chromeIntent()} className="flex h-14 items-center justify-center rounded-full text-[16px] font-extrabold" style={{ background: C.amber, color: C.bg }}>
          {tx(lang, 'Chrome-এ খুলুন', 'Open in Chrome')}
        </a>
        <div className="flex flex-col gap-2 rounded-2xl p-3.5 text-[14px]" style={{ background: '#FFF6E5', color: '#3D2C00' }}>
          <b>{tx(lang, 'বাটন কাজ না করলে:', "If the button doesn't work:")}</b>
          <span>
            1. {tx(lang, 'উপরে ডানে ⋮ চাপুন', 'Tap ⋮ at the top right')}
            <br />
            2. {tx(lang, '"Open in Chrome" চাপুন', 'Tap "Open in Chrome"')}
          </span>
        </div>
        <div className="flex-1" />
        {browserLink}
      </>
    );
  } else if (phone.os === 'ios' && (phone.inApp || phone.iosBrowser === 'other')) {
    body = (
      <>
        {head(tx(lang, 'অ্যাপটা পেতে Safari-তে খুলতে হবে', 'To get the app, open this in Safari'))}
        <button type="button" onClick={() => void copy()} className="h-14 rounded-full text-[16px] font-extrabold" style={{ background: C.amber, color: C.bg }}>
          {copied ? tx(lang, 'কপি হয়েছে ✓', 'Copied ✓') : tx(lang, 'লিংক কপি করুন', 'Copy the link')}
        </button>
        <div className="flex flex-col gap-2 rounded-2xl p-3.5 text-[14px]" style={{ background: '#FFF6E5', color: '#3D2C00' }}>
          <span>
            1. {tx(lang, 'উপরে ডানে ··· বা নিচে ⧉ চাপুন', 'Tap ··· at the top right, or ⧉ at the bottom')}
            <br />
            2. {tx(lang, '"Open in Safari" / "Open in external browser" চাপুন', 'Tap "Open in Safari" / "Open in external browser"')}
          </span>
          <span className="text-[12.5px]" style={{ color: '#6B5310' }}>
            {tx(lang, 'না পেলে: Safari খুলে কপি করা লিংকটা পেস্ট করুন।', 'Not there? Open Safari and paste the copied link.')}
          </span>
        </div>
        <div className="flex-1" />
        {browserLink}
      </>
    );
  } else if (phone.os === 'ios') {
    const share = phone.iosBrowser === 'chrome' ? tx(lang, 'উপরে ডানে শেয়ার', 'Share at the top right') : tx(lang, 'নিচে শেয়ার', 'the Share button below');
    body = (
      <>
        {head(tx(lang, `আপনার হোম স্ক্রিনে ${name} রাখুন — ৩টা ট্যাপ`, `Put ${name} on your home screen in 3 taps`))}
        <div className="flex flex-col gap-2">
          <Step n={1} on={step === 0}>
            {tx(lang, '', 'Tap ')}
            <Glyph>↑</Glyph> {tx(lang, `${share} বাটন চাপুন`, share)}
          </Step>
          <Step n={2} on={step === 1}>
            {tx(lang, 'নিচে স্ক্রল করে ', 'Scroll down, tap ')}
            <b>Add to Home Screen</b>
            {tx(lang, ' চাপুন', '')}
          </Step>
          <Step n={3} on={step === 2}>
            {tx(lang, 'উপরে ডানে ', 'Tap ')}
            <b>Add</b>
            {tx(lang, ' চাপুন', ' at the top right')}
          </Step>
        </div>
        <p className="text-center text-[12.5px]" style={{ color: C.muted }}>
          {tx(lang, 'Add to Home Screen না দেখলে? উপরের Safari আইকনে চেপে Safari-তে খুলুন।', "Don't see Add to Home Screen? Open this in Safari first.")}
        </p>
        <div className="flex-1" />
        <p className="text-center text-[13px]" style={{ color: C.muted }}>
          {tx(lang, `তারপর হোম স্ক্রিনে ${name} খুঁজে নিন`, `Then find ${name} on your home screen`)}
        </p>
        {phone.iosBrowser !== 'chrome' && (
          <p className="animate-bounce text-center text-[13px] font-bold" style={{ color: C.amber }}>
            {tx(lang, '↓ শেয়ার বাটন এখানে', '↓ The Share button is here')}
          </p>
        )}
        {browserLink}
      </>
    );
  } else if (phone.os === 'android') {
    body = (
      <>
        {head(tx(lang, 'অর্ডার করুন আর আমাদের ওয়েটারের সাথে কথা বলুন — হোম স্ক্রিন থেকে এক ট্যাপে', 'Order and talk to our waiter, one tap from your home screen'))}
        <Perks lang={lang} />
        <div className="flex-1" />
        {canPrompt ? (
          <button
            type="button"
            onClick={async () => {
              track('app_install_offered', { data: { source, kind: 'android' } });
              await promptInstall();
            }}
            className="h-14 rounded-full text-[16px] font-extrabold"
            style={{ background: C.amber, color: C.bg }}
          >
            {tx(lang, 'অ্যাপ ইনস্টল করুন', 'Install the app')}
          </button>
        ) : (
          // Chrome didn't offer it (dismissed before, or another browser): its menu still can
          <div className="flex flex-col gap-2 rounded-2xl p-3.5 text-[14px]" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
            <b>{tx(lang, 'ইনস্টল করতে:', 'To install:')}</b>
            <span>
              1. {tx(lang, 'উপরে ডানে ⋮ চাপুন', 'Tap ⋮ at the top right')}
              <br />
              2. {tx(lang, '"Install app" বা "Add to Home screen" চাপুন', 'Tap "Install app" or "Add to Home screen"')}
            </span>
          </div>
        )}
        {browserLink}
      </>
    );
  } else {
    body = (
      <>
        {head(tx(lang, 'ফোনের ক্যামেরা দিয়ে কোডটা স্ক্যান করুন', "Scan the code with your phone's camera"))}
        <div className="self-center rounded-2xl bg-white p-4">
          <QRCodeSVG value={location.href.replace(/\?.*$/, '')} size={200} level="M" marginSize={0} />
        </div>
        <div className="flex-1" />
        {browserLink}
      </>
    );
  }

  return (
    <div className="min-h-[100dvh]" style={{ background: C.bg, color: C.text, fontFamily: 'Inter, "Noto Sans Bengali", system-ui, sans-serif' }}>
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col gap-4 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
            className="h-10 rounded-full px-4 text-[13px] font-semibold"
            style={{ border: `1px solid ${C.line}`, background: C.surf }}
          >
            {lang === 'bn' ? 'English' : 'বাংলা'}
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
