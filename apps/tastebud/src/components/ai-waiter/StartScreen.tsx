// apps/tastebud/src/components/ai-waiter/StartScreen.tsx
// The AI waiter's first screen: the restaurant's logo and name in the middle (the logo is uploaded in the dashboard,
// Settings → Branding), the table for a dine-in guest, and "Get started" at the bottom. The tap on it is what lets the
// browser play the waiter's voice, so the welcome is spoken right after.
import { useState } from 'react';

type Props = {
  name?: string | null;
  logoUrl?: string | null;
  /** dine-in: the guest's table ("12") */
  table?: string | null;
  lang: 'bn' | 'en';
  onStart: () => void;
};

const LOGO = 96; // px — a launch-screen app icon

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '•'
  );
}

export default function StartScreen({ name, logoUrl, table, lang, onStart }: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const loaded = !!name;
  const showLogo = !!logoUrl && !logoFailed;
  const en = lang === 'en';

  return (
    <div
      className="fixed inset-0 z-[1500] flex flex-col items-center bg-gradient-to-b from-[#FFF1F4] via-white to-white px-6"
      style={{ fontFamily: `'Noto Sans Bengali', 'Inter', system-ui, sans-serif` }}
      role="dialog"
      aria-label={name || 'Welcome'}
    >
      {/* the brand, centred */}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div
          className={
            'grid place-items-center overflow-hidden rounded-[28px] bg-white shadow-[0_12px_32px_rgba(250,40,81,0.14)] ring-1 ring-black/[0.04] ' +
            (loaded ? 'qv-start-in' : 'animate-pulse')
          }
          style={{ width: LOGO, height: LOGO }}
        >
          {showLogo ? (
            <img
              src={logoUrl as string}
              alt=""
              className="h-full w-full object-contain p-2"
              onError={() => setLogoFailed(true)}
            />
          ) : loaded ? (
            <span className="text-[34px] font-semibold tracking-tight text-[#FA2851]">{initialsOf(name as string)}</span>
          ) : null}
        </div>

        <h1
          className={
            'mt-5 max-w-[320px] text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#1F1F1F] ' +
            (loaded ? 'qv-start-in' : 'invisible')
          }
          style={{ animationDelay: '60ms' }}
        >
          {name || '…'}
        </h1>

        {table && (
          <span
            className="qv-start-in mt-3 rounded-full bg-[#FA2851]/10 px-3 py-1 text-[13px] font-semibold text-[#FA2851]"
            style={{ animationDelay: '120ms' }}
          >
            {en ? `Table ${table}` : `টেবিল ${table}`}
          </span>
        )}
      </div>

      {/* the one action */}
      <div className="w-full max-w-[400px] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onStart}
          className="h-14 w-full rounded-full bg-[#FA2851] text-[17px] font-semibold text-white shadow-[0_10px_28px_rgba(250,40,81,0.32)] transition active:scale-[0.98] hover:bg-[#E91F47] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#FA2851]/25"
        >
          Get started
        </button>
        <p className="mt-3 text-center text-[12px] text-gray-400">
          {en ? 'Your AI waiter — just talk to order' : 'আপনার AI ওয়েটার — কথা বলেই অর্ডার করুন'}
        </p>
      </div>
    </div>
  );
}
