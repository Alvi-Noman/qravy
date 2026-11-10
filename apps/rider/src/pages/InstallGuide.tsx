// apps/rider/src/pages/InstallGuide.tsx — the rider opens their link in a browser: before their deliveries, the way to
// put the app on their home screen, the same guide guests get for a restaurant's app — only what this phone needs:
//   Android, Chrome → one Install button (Android's own box) · iPhone, Safari / Chrome → the 3 taps, pointing at Share
//   inside WhatsApp / Facebook → open in Chrome (Android, one tap) / Safari (iPhone) first
// "Continue in the browser" always works (and is remembered for a week). On a computer, or once installed, no guide.
import { useEffect, useState } from 'react';
import { chromeIntent, promptInstall, thisPhone, useInstall } from '../install';

type Lang = 'bn' | 'en';
const tx = (lang: Lang, bn: string, en: string) => (lang === 'en' ? en : bn);
const SKIP_KEY = 'qravy:rider:install-skip';
const WEEK = 7 * 24 * 60 * 60 * 1000;

function skippedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SKIP_KEY) || 0) < WEEK;
  } catch {
    return false;
  }
}

function Step({ n, on, children }: { n: number; on: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 text-[16px] transition-colors duration-300 ${on ? 'border-[#0F766E] bg-[#E3F2F0]' : 'border-[#E5E5E5] bg-white'}`}>
      <b className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] transition-colors duration-300 ${on ? 'bg-[#0F766E] text-white' : 'bg-[#EEE] text-[#333]'}`}>{n}</b>
      <span>{children}</span>
    </div>
  );
}
const Glyph = ({ children }: { children: React.ReactNode }) => (
  <span className="mx-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md border-[1.6px] border-current px-1 align-[-5px] text-[13px] font-bold">{children}</span>
);

/** The guide, or — when there's nothing to install here — the page itself. */
export default function InstallGuide({ children }: { children: React.ReactNode }) {
  const [phone] = useState(thisPhone);
  const [skip, setSkip] = useState(skippedRecently);
  const { canPrompt, installedNow } = useInstall();
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('qravy:rider:lang') === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('qravy:rider:lang', lang);
    } catch {
      /* storage blocked */
    }
  }, [lang]);
  useEffect(() => {
    if (phone.os !== 'ios' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % 3), 1600);
    return () => window.clearInterval(id);
  }, [phone.os]);

  if (phone.standalone || phone.os === 'desktop' || skip) return <>{children}</>;

  const later = () => {
    setSkip(true);
    try {
      localStorage.setItem(SKIP_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
  };
  const btn = 'flex h-14 w-full items-center justify-center rounded-2xl bg-[#0F766E] text-[17px] font-bold text-white';
  const help = 'flex flex-col gap-2 rounded-2xl border border-[#F2D59A] bg-[#FFF6E5] p-4 text-[15px] text-[#3D2C00]';

  let body: React.ReactNode;
  if (installedNow) {
    body = (
      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1F7A4D] text-[30px] font-extrabold text-white">✓</span>
        <p className="text-[22px] font-bold">{tx(lang, 'ইনস্টল হয়ে গেছে!', 'Installed!')}</p>
        <p className="text-[15px] text-[#555]">{tx(lang, 'হোম স্ক্রিনে Rider আইকন থেকে খুলুন — আপনার ডেলিভারি সেখানেই।', 'Open Rider from your home screen — your deliveries are there.')}</p>
      </div>
    );
  } else if (phone.os === 'android' && phone.inApp) {
    body = (
      <>
        <p className="text-center text-[15px] text-[#555]">{tx(lang, 'অ্যাপটা পেতে আগে Chrome-এ খুলুন', 'Open this in Chrome first to get the app')}</p>
        <a href={chromeIntent()} className={btn}>
          {tx(lang, 'Chrome-এ খুলুন', 'Open in Chrome')}
        </a>
        <div className={help}>
          <b>{tx(lang, 'বাটন কাজ না করলে:', "If the button doesn't work:")}</b>
          <span>
            1. {tx(lang, 'উপরে ডানে ⋮ চাপুন', 'Tap ⋮ at the top right')}
            <br />
            2. {tx(lang, '"Open in Chrome" চাপুন', 'Tap "Open in Chrome"')}
          </span>
        </div>
      </>
    );
  } else if (phone.os === 'ios' && (phone.inApp || phone.iosBrowser === 'other')) {
    body = (
      <>
        <p className="text-center text-[15px] text-[#555]">{tx(lang, 'অ্যাপটা পেতে Safari-তে খুলতে হবে', 'To get the app, open this in Safari')}</p>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className={btn}
        >
          {copied ? tx(lang, 'কপি হয়েছে ✓', 'Copied ✓') : tx(lang, 'লিংক কপি করুন', 'Copy the link')}
        </button>
        <div className={help}>
          <span>
            1. {tx(lang, 'উপরে ডানে ··· বা নিচে ⧉ চাপুন', 'Tap ··· at the top right, or ⧉ at the bottom')}
            <br />
            2. {tx(lang, '"Open in Safari" চাপুন', 'Tap "Open in Safari"')}
          </span>
          <span className="text-[13px] text-[#6B5310]">{tx(lang, 'না পেলে: Safari খুলে কপি করা লিংকটা পেস্ট করুন।', 'Not there? Open Safari and paste the copied link.')}</span>
        </div>
      </>
    );
  } else if (phone.os === 'ios') {
    const where = phone.iosBrowser === 'chrome' ? tx(lang, 'উপরে ডানে', 'at the top right') : tx(lang, 'নিচে', 'below');
    body = (
      <>
        <p className="text-center text-[15px] text-[#555]">{tx(lang, 'হোম স্ক্রিনে রাখুন — ৩টা ট্যাপ', 'Put it on your home screen in 3 taps')}</p>
        <div className="flex flex-col gap-2">
          <Step n={1} on={step === 0}>
            {tx(lang, `${where} `, 'Tap ')}
            <Glyph>↑</Glyph>
            {tx(lang, ' শেয়ার বাটন চাপুন', ` Share ${where}`)}
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
        <p className="text-center text-[13px] text-[#777]">
          {tx(lang, 'Add to Home Screen না দেখলে? আগে Safari-তে খুলুন।', "Don't see Add to Home Screen? Open this in Safari first.")}
        </p>
        {phone.iosBrowser !== 'chrome' && <p className="animate-bounce text-center text-[14px] font-bold text-[#0F766E]">{tx(lang, '↓ শেয়ার বাটন এখানে', '↓ The Share button is here')}</p>}
      </>
    );
  } else {
    body = (
      <>
        <div className="flex flex-col gap-2.5 rounded-2xl border border-[#E5E5E5] bg-white p-4 text-[15px]">
          {[
            tx(lang, 'নতুন ডেলিভারি এলে সাথে সাথে দেখবেন', 'New deliveries show up right away'),
            tx(lang, 'কাস্টমারকে কল, ম্যাপ, কত টাকা নিতে হবে — এক জায়গায়', 'Call, map and cash to collect — in one place'),
            tx(lang, 'লগইন লাগবে না, এক ট্যাপে খুলবে', 'No login, opens in one tap'),
          ].map((t) => (
            <span key={t} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3F2F0] text-[12px] font-extrabold text-[#0F766E]">✓</span>
              {t}
            </span>
          ))}
        </div>
        {canPrompt ? (
          <button type="button" onClick={() => void promptInstall()} className={btn}>
            {tx(lang, 'অ্যাপ ইনস্টল করুন', 'Install the app')}
          </button>
        ) : (
          <div className={help}>
            <b>{tx(lang, 'ইনস্টল করতে:', 'To install:')}</b>
            <span>
              1. {tx(lang, 'উপরে ডানে ⋮ চাপুন', 'Tap ⋮ at the top right')}
              <br />
              2. {tx(lang, '"Install app" বা "Add to Home screen" চাপুন', 'Tap "Install app" or "Add to Home screen"')}
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#F6F6F4] text-[#111]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col gap-4 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-[calc(env(safe-area-inset-top,0px)+16px)]">
        <div className="flex justify-end">
          <button type="button" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')} className="h-10 rounded-full border border-[#D5D5D5] bg-white px-4 text-[13px] font-semibold">
            {lang === 'bn' ? 'English' : 'বাংলা'}
          </button>
        </div>
        <div className="flex flex-col items-center gap-2.5 text-center">
          <img src="/icons/icon-192.png" alt="" className="h-20 w-20 rounded-[22px] shadow-md" />
          <p className="text-[26px] font-bold tracking-[-0.3px]">Qravy Rider</p>
          <p className="max-w-[28ch] text-[15px] text-[#555]">{tx(lang, 'আপনার ডেলিভারি, হোম স্ক্রিন থেকে এক ট্যাপে', 'Your deliveries, one tap from your home screen')}</p>
        </div>
        {body}
        <div className="flex-1" />
        <button type="button" onClick={later} className="h-12 text-[15px] font-semibold text-[#555] underline underline-offset-4">
          {installedNow ? tx(lang, 'এখানেই দেখুন', 'See them here') : tx(lang, 'ব্রাউজারেই চালিয়ে যান', 'Continue in the browser')}
        </button>
      </div>
    </div>
  );
}
