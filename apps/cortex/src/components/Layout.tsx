// apps/cortex/src/components/Layout.tsx — Cortex's frame: the sidebar, who's signed in, sign out.
import { NavLink, Outlet } from 'react-router-dom';
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
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { api, setToken } from '../api';

const NAV = [
  { to: '/', label: 'Overview', icon: ChartBarSquareIcon, end: true },
  { to: '/live', label: 'Live', icon: SignalIcon },
  { to: '/restaurants', label: 'Restaurants', icon: BuildingStorefrontIcon },
  { to: '/sessions', label: 'Guest sessions', icon: CursorArrowRaysIcon },
  { to: '/transcripts', label: 'Live transcripts', icon: MicrophoneIcon },
  { to: '/conversations', label: 'AI conversations', icon: ChatBubbleLeftRightIcon },
  { to: '/orders', label: 'Orders', icon: ReceiptPercentIcon },
  { to: '/pronunciation', label: 'Pronunciation', icon: SpeakerWaveIcon },
];

export default function Layout({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  // restaurants' pronunciation requests waiting for review: a count on the link
  const waiting = useQuery({
    queryKey: ['lexicon-requests', false],
    queryFn: () => api<{ pending: number }>('/pronunciations/requests'),
    refetchInterval: 60_000,
  }).data?.pending;
  const badge = (to: string) =>
    to === '/pronunciation' && waiting ? (
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
