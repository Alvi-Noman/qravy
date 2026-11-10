// apps/braincell/src/components/riders/RiderAppGuide.tsx — on the Riders page: the rider app for Android, and how a
// rider gets it. Download the APK (or share its link) → forward it on WhatsApp → the rider installs it (Android asks to
// allow installs from WhatsApp once) → the rider signs in with their own link or QR code. The app updates itself (it
// is the rider web app inside), so it's sent once. iPhone riders use the link in Safari. Collapsible; remembered.
import { useEffect, useState } from 'react';
import { ArrowDownTrayIcon, CheckCircleIcon, ChevronDownIcon, LinkIcon, QrCodeIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { riderApkUrl, riderAppBase } from '../../api/riders';

type ApkInfo = { version: string; bytes: number; builtAt: string } | null | 'loading';

const KEY = 'riders:guide-open';
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** The APK's version and size, from the rider app (version.json next to it) — null when it isn't built yet. */
export function useRiderApk(): ApkInfo {
  const [info, setInfo] = useState<ApkInfo>('loading');
  useEffect(() => {
    let alive = true;
    fetch(`${riderAppBase()}/download/version.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setInfo(d && typeof d.version === 'string' ? d : null))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** What a restaurant sends to share the app (no rider yet): the download link, and that their own link follows. */
export function appShareText(restaurant: string) {
  return `${restaurant}: install the Qravy Rider app for your deliveries.\nAndroid: ${riderApkUrl()}\niPhone: open your rider link in Safari.`;
}

function Step({ n, title, children, icon }: { n: number; title: string; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-[#ececf0] bg-white p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0F766E] text-xs font-bold text-white">{n}</span>
        <span className="font-semibold text-[#2e2e30]">{title}</span>
        <span className="ml-auto text-[#0F766E]">{icon}</span>
      </div>
      <div className="text-sm leading-relaxed text-[#5b5b60]">{children}</div>
    </li>
  );
}

export default function RiderAppGuide({ restaurant, onCopied }: { restaurant: string; onCopied: (msg: string) => void }) {
  const apk = useRiderApk();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !o;
    });
  };
  const ready = apk !== 'loading' && apk !== null;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(riderApkUrl());
      onCopied('Download link copied — paste it in WhatsApp.');
    } catch {
      onCopied(riderApkUrl());
    }
  };

  return (
    <section aria-label="Rider app" className="overflow-hidden rounded-2xl border border-[#e6e6ea] bg-gradient-to-br from-[#F2FAF8] via-white to-white">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <img src={`${riderAppBase()}/icons/icon-192.png`} alt="" className="h-14 w-14 shrink-0 rounded-2xl shadow-sm" />
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[#2e2e30]">Qravy Rider app</h2>
            {apk === 'loading' ? null : ready ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                Android · v{apk.version} · {mb(apk.bytes)}
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Android app coming soon</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-[#6b6b70]">
            {ready
              ? 'Send it to your riders once — it updates itself. They see their deliveries, call the customer, and tap Picked up → Delivered.'
              : "Riders can already use their link in the phone's browser. The Android app to install will appear here."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready && (
            <>
              <a href={riderApkUrl()} download className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0c5f59]">
                <ArrowDownTrayIcon className="h-4 w-4" />
                Download APK
              </a>
              <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9d9de] bg-white px-3.5 py-2.5 text-sm font-medium text-[#2e2e30]">
                <LinkIcon className="h-4 w-4" />
                Copy download link
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(appShareText(restaurant))}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E7F7EE] px-3.5 py-2.5 text-sm font-semibold text-[#11703F] ring-1 ring-[#BFE6CF]"
              >
                Share on WhatsApp
              </a>
            </>
          )}
          <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#6b6b70] hover:text-[#2e2e30]">
            {open ? 'Hide guide' : 'How riders get it'}
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#ececf0] bg-[#fafafb] p-5">
          <ol className="flex flex-col gap-3 lg:flex-row">
            <Step n={1} title="Send the app" icon={<ArrowDownTrayIcon className="h-5 w-5" />}>
              {ready ? (
                <>
                  Tap <b>Download APK</b> and forward the file to the rider in WhatsApp, or tap <b>Share on WhatsApp</b> to send the download link
                  instead. One app works for every rider.
                </>
              ) : (
                <>Not needed yet: send each rider their own link (<b>Send link</b> next to their name). It opens in the browser.</>
              )}
            </Step>
            <Step n={2} title="Rider installs it" icon={<ShieldCheckIcon className="h-5 w-5" />}>
              Android asks once to allow installs from WhatsApp: <b>Settings → Allow from this source → Install</b>. If Play Protect says it doesn't
              recognise the app, tap <b>Install anyway</b>.
            </Step>
            <Step n={3} title="Rider signs in" icon={<QrCodeIcon className="h-5 w-5" />}>
              The rider opens <b>their own link</b> (Send link next to their name), or opens the app and scans their <b>QR code</b> from this page. No
              password — the link is their key.
            </Step>
          </ol>
          <ul className="mt-4 flex flex-col gap-1.5 text-sm text-[#5b5b60] sm:flex-row sm:flex-wrap sm:gap-x-6">
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              Updates arrive by themselves — no need to send the app again.
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              iPhone: no install — the rider's link works in Safari (Share → Add to Home Screen).
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              Lost phone? <b>Reset link</b> — the old one stops working at once.
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
