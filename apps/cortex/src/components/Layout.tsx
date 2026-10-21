// apps/cortex/src/components/Layout.tsx — Cortex's frame: the sidebar, who's signed in, sign out.
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  BuildingStorefrontIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  CursorArrowRaysIcon,
  ReceiptPercentIcon,
  SignalIcon,
  ArrowRightOnRectangleIcon,
  MicrophoneIcon,
  SpeakerWaveIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { api, setToken, type SttInfo } from '../api';

const NAV = [
  { to: '/', label: 'Overview', icon: ChartBarSquareIcon, end: true },
  { to: '/live', label: 'Live', icon: SignalIcon },
  { to: '/restaurants', label: 'Restaurants', icon: BuildingStorefrontIcon },
  { to: '/sessions', label: 'Guest sessions', icon: CursorArrowRaysIcon },
  { to: '/transcripts', label: 'Live transcripts', icon: MicrophoneIcon },
  { to: '/conversations', label: 'AI conversations', icon: ChatBubbleLeftRightIcon },
  { to: '/orders', label: 'Orders', icon: ReceiptPercentIcon },
  { to: '/pronunciation', label: 'Pronunciation', icon: SpeakerWaveIcon },
  { to: '/speech-to-text', label: 'Speech-to-text', icon: LanguageIcon },
];

export default function Layout({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  // restaurants' pronunciation requests waiting for review: a count on the link
  const waiting = useQuery({
    queryKey: ['lexicon-requests', false],
    queryFn: () => api<{ pending: number }>('/pronunciations/requests'),
    refetchInterval: 60_000,
  }).data?.pending;
  // ElevenLabs credits low / used up → a dot on the link and a banner on every page
  const stt = useQuery({ queryKey: ['stt'], queryFn: () => api<SttInfo>('/stt'), refetchInterval: 5 * 60_000 }).data?.status;
  const sttAlert = stt?.configured && (stt.out || stt.low) ? (stt.out ? 'out' : 'low') : null;
  const badge = (to: string) =>
    to === '/speech-to-text' && sttAlert ? (
      <span className={`ml-auto h-2.5 w-2.5 rounded-full ${sttAlert === 'out' ? 'bg-red-500' : 'bg-amber-500'}`} />
    ) : to === '/pronunciation' && waiting ? (
      <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{waiting}</span>
    ) : null;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200 bg-white px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/cortex.svg" alt="" className="h-7 w-7" />
          <div>
            <div className="text-[15px] font-semibold leading-tight text-stone-900">Cortex</div>
            <div className="text-[11px] text-stone-500">Qravy platform</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] ${isActive ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`
              }
            >
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
              {badge(n.to)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-100 px-2 pt-3">
          <div className="truncate text-[12px] text-stone-500" title={email}>
            {email}
          </div>
          <button
            type="button"
            onClick={() => {
              setToken(null);
              onSignOut();
            }}
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-stone-700 hover:text-stone-900"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      {/* phones: a top bar with the same links */}
      <div className="min-w-0 flex-1">
        <div className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-3 py-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] ${isActive ? 'bg-stone-900 text-white' : 'text-stone-700'}`}
            >
              {n.label}
              {badge(n.to) && <span className="ml-1">{badge(n.to)}</span>}
            </NavLink>
          ))}
        </div>
        <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
          {sttAlert && (
            <Link
              to="/speech-to-text"
              className={`mb-4 block rounded-lg border px-4 py-3 text-[13px] ${sttAlert === 'out' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
            >
              {sttAlert === 'out'
                ? 'ElevenLabs credits are used up — the AI waiter is hearing every guest with gpt-4o. Top up to switch back.'
                : `ElevenLabs credits are low (${(stt?.left ?? 0).toLocaleString()} left) — top up soon.`}{' '}
              <span className="underline">Details</span>
            </Link>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
