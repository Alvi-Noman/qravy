/**
 * Settings → Kitchen: every dish's own prep time. Shows how many dishes have one (and from where), and lets
 * the owner have AI estimate the rest in one go. Times the owner set are never overwritten.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { estimatePrepTimes, getPrepTimeStatus, type PrepTimeStatus } from '../../api/menuItems';
import { toastError, toastSuccess } from '../Toaster';

export default function PrepTimesPanel() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PrepTimeStatus | null>(null);
  const [aiOn, setAiOn] = useState(true);
  const [running, setRunning] = useState<null | 'fill' | 'redo'>(null);

  useEffect(() => {
    if (!token) return;
    getPrepTimeStatus(token)
      .then((r) => {
        setStatus(r.status);
        setAiOn(r.ai);
      })
      .catch(() => setStatus(null));
  }, [token]);

  const run = async (redoAi: boolean) => {
    if (!token) return;
    setRunning(redoAi ? 'redo' : 'fill');
    try {
      const r = await estimatePrepTimes(token, { redoAi });
      setStatus(r.status);
      await queryClient.invalidateQueries({ queryKey: ['menu-items'] });
      toastSuccess(
        r.updated
          ? `${r.source === 'ai' ? 'AI estimated' : 'Estimated'} prep times for ${r.updated} dish${r.updated === 1 ? '' : 'es'}`
          : 'Every dish already has a prep time'
      );
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not estimate prep times');
    } finally {
      setRunning(null);
    }
  };

  if (!status || !status.total) return null;
  const own = status.owner + status.menu;
  const needs = status.missing + status.guess;

  return (
    <div className="mt-5 rounded-lg border border-[#ececec] bg-[#fcfcfc] p-3">
      <div className="text-[13px] font-semibold text-slate-900">Prep time per dish</div>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Each dish has its own time — a soup isn’t a sizzler. New dishes get one automatically; you can change any of
        them on the dish.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat n={own} label="set by you / menu" />
        <Stat n={status.ai} label="AI estimates" tone="violet" />
        <Stat n={needs} label="still need a time" tone={needs ? 'amber' : undefined} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {status.ai > 0 && (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={!!running}
            className="rounded-md border border-[#e2e2e2] bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Estimate the AI times again (times you set stay as they are)"
          >
            {running === 'redo' ? 'Re-estimating…' : 'Re-estimate AI times'}
          </button>
        )}
        <button
          type="button"
          onClick={() => run(false)}
          disabled={!!running || !needs}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <SparklesIcon className="h-4 w-4" aria-hidden="true" />
          {running === 'fill'
            ? 'Estimating…'
            : needs
              ? `Estimate ${needs} dish${needs === 1 ? '' : 'es'} with AI`
              : 'All dishes have a time'}
        </button>
      </div>
      {!aiOn && (
        <p className="mt-2 text-[11px] text-amber-700">
          AI isn’t configured on the server, so times come from the dish type instead.
        </p>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'violet' | 'amber' }) {
  const color = tone === 'violet' ? 'text-violet-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="rounded-md bg-white px-2 py-2 ring-1 ring-[#ececec]">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{n}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
