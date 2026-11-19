// apps/cortex/src/pages/FlaggedAnswers.tsx — the AI waiter's answers that look wrong, every restaurant, the latest
// first: why each was flagged, the turn before and after, and a verdict (fixed / not a problem) so the list is a
// to-do. "Copy for fix" puts the whole case on the clipboard, ready to hand to whoever fixes the waiter.
// The checks: auth-service services/cortex/answerChecks.ts (word patterns, no AI calls).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FlaggedAnswer, type FlaggedList, type FlagSeverity, type TenantRow } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, fmt } from '../components/ui';
import VoiceClip from '../components/VoiceClip';

const TONE: Record<FlagSeverity, 'bad' | 'warn' | 'info'> = { bad: 'bad', check: 'warn', caught: 'info' };
const STATUS = [
  { v: 'open', label: 'To review' },
  { v: 'reviewed', label: 'Reviewed' },
  { v: 'all', label: 'All' },
] as const;

export default function FlaggedAnswers() {
  const [days, setDays] = useState(7);
  const [tenant, setTenant] = useState('');
  const [status, setStatus] = useState<'open' | 'reviewed' | 'all'>('open');
  const [caught, setCaught] = useState(false);
  const [code, setCode] = useState('');
  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const qs = new URLSearchParams({
    days: String(days),
    status,
    severity: caught ? 'bad,check,caught' : 'bad,check',
    ...(tenant ? { tenant } : {}),
    ...(code ? { code } : {}),
  });
  const list = useQuery({ queryKey: ['flagged', qs.toString()], refetchInterval: 60_000, queryFn: () => api<FlaggedList>(`/flagged?${qs}`) });
  const checks = Object.entries(list.data?.checks ?? {}).filter(([k, c]) => (caught || c.severity !== 'caught') && (list.data?.counts[k] ?? 0) > 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">Flagged answers</h1>
          <p className="text-[13px] text-stone-500">
            AI waiter answers that look wrong — the AI failed, claimed something it didn&apos;t do, answered in the wrong language, or the guest
            pushed back, repeated themselves or undid it. Mark each one fixed or not a problem.
          </p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <select value={tenant} onChange={(e) => setTenant(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">All restaurants</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-[13px]" role="group" aria-label="Status">
          {STATUS.map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => setStatus(s.v)}
              className={`rounded-md px-3 py-1.5 ${status === s.v ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[13px] text-stone-600">
          <input type="checkbox" checked={caught} onChange={(e) => setCaught(e.target.checked)} />
          Include mistakes the safety net already fixed
        </label>
      </div>

      {list.data && checks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!code} onClick={() => setCode('')}>
            All · {list.data.total}
          </Chip>
          {checks
            .sort((a, b) => (list.data.counts[b[0]] ?? 0) - (list.data.counts[a[0]] ?? 0))
            .map(([k, c]) => (
              <Chip key={k} active={code === k} tone={c.severity} onClick={() => setCode(code === k ? '' : k)}>
                {c.label} · {list.data.counts[k]}
              </Chip>
            ))}
        </div>
      )}

      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data &&
        (list.data.items.length ? (
          <ul className="space-y-3">
            {list.data.items.map((a) => (
              <FlaggedCard key={a.id} a={a} />
            ))}
          </ul>
        ) : (
          <Empty>{status === 'open' ? 'Nothing to review — no answer looks wrong in this period.' : 'Nothing here.'}</Empty>
        ))}
    </div>
  );
}

function Chip({ children, active, tone, onClick }: { children: React.ReactNode; active: boolean; tone?: FlagSeverity; onClick: () => void }) {
  const dot = tone === 'bad' ? 'bg-red-500' : tone === 'check' ? 'bg-amber-500' : tone === 'caught' ? 'bg-sky-500' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
      }`}
    >
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

function FlaggedCard({ a }: { a: FlaggedAnswer }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(a.review?.note ?? '');
  const [copied, setCopied] = useState(false);
  const review = useMutation({
    mutationFn: (status: 'fixed' | 'not_a_problem' | null) =>
      api(`/flagged/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify({ status, note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flagged'] }),
  });
  const t = a.turn;
  const where = `${a.restaurant}${a.branch ? ` · ${a.branch}` : ''} · ${t.channel === 'dine-in' ? `table ${t.table ?? '?'}` : 'online'}`;
  const copy = async () => {
    await navigator.clipboard.writeText(fixBrief(a, where));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="text-[12px] text-stone-500">
            {where} · {fmt.time(t.at)}, {new Date(t.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </div>
          <div className="flex flex-wrap gap-1">
            {a.review && <Badge tone={a.review.status === 'fixed' ? 'good' : 'neutral'}>{a.review.status === 'fixed' ? 'fixed' : 'not a problem'}</Badge>}
            {a.leftAfter && <Badge tone="warn">guest left after this</Badge>}
          </div>
        </div>
        <div className="mt-2 space-y-1">
          {a.findings.map((f) => (
            <div key={f.code} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <Badge tone={TONE[f.severity]}>{f.label}</Badge>
              {f.detail && <span className="text-stone-600">{f.detail}</span>}
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-2 text-[13px]">
          {a.before && <Exchange heard={a.before.heard} said={a.before.said} unheard={a.before.unheard} dim />}
          <div className="rounded-lg border-l-4 border-red-400 bg-red-50/40 px-3 py-2">
            <Line who="Guest">
              {t.heard || <span className="italic text-stone-400">(nothing)</span>}
              {t.audio && <VoiceClip id={t.audio} />}
              {t.understood.text && <span className="ml-2 text-[12px] text-stone-500">→ {t.understood.text}</span>}
            </Line>
            {(t.understood.intent || t.understood.actions.length > 0) && (
              <Line who="Understood">
                <span className="text-stone-600">
                  {[t.understood.intent, ...t.understood.actions.map((x) => `${x.op} ${x.quantity ? `${x.quantity}× ` : ''}${x.name ?? ''}${x.variant ? ` (${x.variant})` : ''}`)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Line>
            )}
            <Line who="Waiter">
              <span className="font-medium text-stone-900">{t.said || <span className="italic text-stone-400">(nothing)</span>}</span>
            </Line>
            {t.flags.length > 0 && <div className="mt-1 text-[11px] text-stone-500">safety net: {t.flags.join(', ')}</div>}
          </div>
          {a.after && <Exchange heard={a.after.heard} said={a.after.said} unheard={a.after.unheard} dim />}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link to={`/conversations?open=${encodeURIComponent(a.conversationId)}${a.tenantId ? `&tenant=${a.tenantId}` : ''}`} className="text-[13px] underline">
            Open conversation
          </Link>
          <button type="button" onClick={copy} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] hover:bg-stone-50">
            {copied ? 'Copied' : 'Copy for fix'}
          </button>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="min-w-[160px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-stone-500"
          />
          {a.review ? (
            <button type="button" disabled={review.isPending} onClick={() => review.mutate(null)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-[13px]">
              Undo
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate('fixed')}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
              >
                Fixed
              </button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate('not_a_problem')}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] disabled:opacity-50"
              >
                Not a problem
              </button>
            </>
          )}
        </div>
        {review.error && <div className="mt-2"><ErrorBox error={review.error} /></div>}
        {a.review?.by && (
          <div className="mt-1 text-[11px] text-stone-500">
            {a.review.by}
            {a.review.at ? ` · ${new Date(a.review.at).toLocaleString()}` : ''}
          </div>
        )}
      </Card>
    </li>
  );
}

function Line({ who, children }: { who: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <span className="text-stone-500">{who}</span>
      <span>{children}</span>
    </div>
  );
}

function Exchange({ heard, said, unheard, dim }: { heard: string; said: string; unheard: boolean; dim?: boolean }) {
  return (
    <div className={`px-3 ${dim ? 'text-stone-500' : ''}`}>
      <Line who="Guest">{unheard ? <span className="italic">(not heard)</span> : heard || '…'}</Line>
      <Line who="Waiter">{said || '…'}</Line>
    </div>
  );
}

/** The case as plain text — paste it to whoever fixes the waiter (services/ai-waiter-service/CLAUDE.md, "How to fix a bad answer"). */
function fixBrief(a: FlaggedAnswer, where: string): string {
  const t = a.turn;
  const L: string[] = [];
  L.push(`AI waiter — answer flagged in Cortex: ${a.findings.map((f) => f.label + (f.detail ? ` (${f.detail})` : '')).join('; ')}`);
  L.push(`Where: ${where} (${a.subdomain ?? '?'}) · ${new Date(t.at).toISOString()} · ${t.input}${t.understood.language ? ` · ${t.understood.language}` : ''}`);
  L.push('');
  if (a.before) L.push(`Before — Guest: ${a.before.unheard ? '(not heard)' : a.before.heard}`, `Before — Waiter: ${a.before.said}`, '');
  L.push(`Guest: ${t.heard}${t.understood.text ? `   (cleaned up: ${t.understood.text})` : ''}`);
  const did = t.understood.actions.map((x) => `${x.op} ${x.quantity ?? ''} ${x.name ?? ''}${x.variant ? ` (${x.variant})` : ''}`.replace(/\s+/g, ' ').trim());
  if (t.understood.intent || did.length) L.push(`Understood: ${[t.understood.intent, ...did].filter(Boolean).join(' · ')}`);
  L.push(`Waiter: ${t.said}`);
  if (t.flags.length) L.push(`Safety net: ${t.flags.join(', ')}`);
  if (a.after) L.push('', `Next — Guest: ${a.after.unheard ? '(not heard)' : a.after.heard}`, `Next — Waiter: ${a.after.said}`);
  if (a.leftAfter) L.push('', 'The guest left after this answer without ordering.');
  L.push('', 'Fix the cause (not a special case for these words) and add this conversation to the replay set.');
  return L.join('\n');
}
