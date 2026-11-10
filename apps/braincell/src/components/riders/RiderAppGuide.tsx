// apps/braincell/src/components/riders/RiderAppGuide.tsx — on the Riders page: how a rider gets the Qravy Rider app.
// No download, no store: the rider opens their own link (WhatsApp, or the QR code here) and the page shows that phone's
// way to put it on the home screen — one tap on Android, Share → Add to Home Screen on iPhone (the same guide guests get
// for a restaurant's app). The app then opens straight to their deliveries, signed in, and updates itself.
// Collapsible; remembered on this computer.
import { useState } from 'react';
import { ChatBubbleLeftRightIcon, CheckCircleIcon, ChevronDownIcon, DevicePhoneMobileIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { riderAppBase } from '../../api/riders';

const KEY = 'riders:guide-open';

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

export default function RiderAppGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !o;
    });

  return (
    <section aria-label="Rider app" className="overflow-hidden rounded-2xl border border-[#e6e6ea] bg-gradient-to-br from-[#F2FAF8] via-white to-white">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <img src={`${riderAppBase()}/icons/icon-192.png`} alt="" className="h-14 w-14 shrink-0 rounded-2xl shadow-sm" />
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[#2e2e30]">Qravy Rider app</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Android & iPhone · nothing to download
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[#6b6b70]">
            Send a rider their link. It shows them how to put the app on their home screen, then opens straight to their deliveries. It updates
            itself.
          </p>
        </div>
        <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#6b6b70] hover:text-[#2e2e30]">
          {open ? 'Hide guide' : 'How riders get it'}
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-[#ececf0] bg-[#fafafb] p-5">
          <ol className="flex flex-col gap-3 lg:flex-row">
            <Step n={1} title="Send their link" icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />}>
              Tap <b>Send link</b> next to the rider&apos;s name. WhatsApp opens with the message written. Or let them scan their <b>QR</b> code from this
              page with the phone&apos;s camera.
            </Step>
            <Step n={2} title="They install it" icon={<DevicePhoneMobileIcon className="h-5 w-5" />}>
              The link shows their phone&apos;s way. <b>Android:</b> one tap on <b>Install</b>. <b>iPhone:</b> Share → <b>Add to Home Screen</b> → Add. If
              it opens inside WhatsApp, the page helps them open it in Chrome or Safari first.
            </Step>
            <Step n={3} title="Done" icon={<QrCodeIcon className="h-5 w-5" />}>
              A <b>Rider</b> icon on their home screen opens their deliveries, signed in. No password: their link is their key.
            </Step>
          </ol>
          <ul className="mt-4 flex flex-col gap-1.5 text-sm text-[#5b5b60] sm:flex-row sm:flex-wrap sm:gap-x-6">
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              Updates arrive by themselves. Nothing to send again.
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              Don&apos;t want to install? The link works in the browser too.
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircleIcon className="h-4 w-4 text-[#0F766E]" />
              Lost phone? <b>Reset link</b>: the old one stops working at once.
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
