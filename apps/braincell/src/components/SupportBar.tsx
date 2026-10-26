// apps/braincell/src/components/SupportBar.tsx — Qravy support access: when a Qravy admin opened this dashboard from
// Cortex (auth-service supportRoutes), a bar across the top of every screen says so — who, until when — with Exit,
// which ends the session at once. Owners never see it in their own sessions. Also: the card in Settings → Security
// that shows the restaurant when Qravy support was in its account.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../context/AuthContext';
import api, { getMe } from '../api/auth';

type Support = { by: string; until: string };

const CORTEX_URL = (import.meta.env.VITE_CORTEX_URL as string | undefined) || 'https://cortex.qravy.com';
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function SupportBar() {
  const { token } = useAuthContext();
  const me = useQuery({
    queryKey: ['me-support', !!token],
    queryFn: () => getMe<{ support?: Support }>(token ?? undefined),
    enabled: !!token,
    staleTime: 60_000,
  });
  const support = me.data?.support;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!support) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [support]);
  if (!support) return null;

  const left = Math.max(0, Math.round((new Date(support.until).getTime() - now) / 60000));
  const exit = async () => {
    try {
      await api.post('/api/v1/auth/support/end');
    } catch {
      /* ended already */
    }
    window.close(); // opened from Cortex in its own tab
    window.location.href = CORTEX_URL;
  };
  return (
    <div className="sticky top-0 z-[2000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-red-600 px-4 py-1.5 text-[13px] text-white">
      <span className="font-semibold">Qravy support</span>
      <span>
        You’re in this restaurant’s dashboard as an admin ({support.by}) · ends {time(support.until)} ({left} min) · every change is logged
      </span>
      <button type="button" onClick={() => void exit()} className="rounded-md bg-white/15 px-2.5 py-0.5 font-semibold hover:bg-white/25">
        Exit
      </button>
    </div>
  );
}

type AccessRow = { id: string; by: string; reason: string; startedAt: string; endedAt: string | null; active: boolean; changes: number };

/** Settings → Security: every time Qravy support opened this restaurant's dashboard. */
export function SupportAccessCard() {
  const q = useQuery({
    queryKey: ['support-access'],
    queryFn: async () => (await api.get('/api/v1/tenants/me/support-access')).data.items as AccessRow[],
  });
  const items = q.data ?? [];
  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Qravy support access</div>
      <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
        When the Qravy team opens your dashboard to help you — who, when, why and how many changes they made (setting up your plan
        or adding admins included). Each visit lasts at most an hour, and your own sign-ins are never touched.
      </p>
      {items.length ? (
        <ul className="mt-3 divide-y divide-slate-100 text-[13px]">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-slate-800">
                {new Date(s.startedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {s.by}
                {s.reason ? <span className="text-slate-500"> — {s.reason}</span> : null}
              </span>
              <span className="text-xs text-slate-500">
                {s.active ? <span className="font-medium text-red-600">in your dashboard now</span> : `${s.changes} change${s.changes === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-slate-500">Qravy support hasn’t opened your dashboard.</p>
      )}
    </div>
  );
}
