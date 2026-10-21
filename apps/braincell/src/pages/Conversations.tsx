/**
 * AI Conversations (owners and admins only): every conversation the AI waiter had with guests, and turn by turn
 * what it heard (the speech-to-text, or what the guest typed), what it understood (the menu-name fixes, the intent,
 * what it changed in the tray, the order it placed) and what it said back.
 * From the transcripts the waiter stores (ai-waiter-service /conversations, kept 30 days); follows the sidebar's
 * branch picker. The selected conversation is in the URL (?session=…) so it can be shared with a teammate.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  MicrophoneIcon,
  PencilSquareIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline';
import { useAuthContext } from '../context/AuthContext';
import { usePermissions } from '../context/PermissionsContext';
import { useScope } from '../context/ScopeContext';
import { useTenant } from '../hooks/useTenant';
import { waiterFetch } from '../api/waiter';

type ConversationSummary = {
  /** one session: a guest's visit at one branch, until 30 minutes of quiet ("<session>@<location>~<start>") */
  id?: string;
  session: string;
  startedAt: string;
  lastAt: string;
  /** how long the visit's talk lasted */
  minutes?: number;
  turns: number;
  unheard: number;
  flagged: number;
  ordered: boolean;
  preview: string;
  language: string | null;
  table: string | null;
  channel: string | null;
  branch: string | null;
};

/** A session is one guest's visit at one branch; older waiter versions only sent the guest's session id. */
const convoId = (c: ConversationSummary) => c.id ?? c.session;

type Action = { op: string; name?: string; quantity?: number; variant?: string; note?: string };

type Turn = {
  at: string;
  input: 'voice' | 'typed';
  heard: string;
  unheard: boolean;
  /** what the guest said, as sound (kept a few days) — GET /voice-clip */
  audio?: string | null;
  understood: {
    text: string | null;
    corrections: { from: string; to: string }[];
    language: string | null;
    intent: string | null;
    topic: string | null;
    actions: Action[];
    mentioned: string[];
    suggested: string[];
    serviceRequest: { type?: string; note?: string } | null;
    orderPlaced: boolean;
    orderNumber?: number | string | null;
  };
  said: string;
  flags: string[];
};

const DAYS = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

// the waiter's own tags for a turn it stepped in on — the common ones in plain words, the rest as they are
const FLAG_LABEL: Record<string, string> = {
  'no-speech': 'Heard nothing',
  'no-audio': 'No audio arrived',
  unclear: "Couldn't make it out",
  not_understood: "Didn't understand",
  model_unavailable: 'AI unavailable',
};

const LANG_LABEL: Record<string, string> = { bn: 'Bangla', en: 'English' };

const words = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '');

type WaiterResponse = { ok?: boolean; error?: string; conversations?: ConversationSummary[]; turns?: Turn[] };

function useWaiterGet<T>(key: unknown[], path: string, enabled: boolean, pick: (data: WaiterResponse) => T) {
  const { getToken, refreshToken } = useAuthContext();
  return useQuery<T>({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const res = await waiterFetch(path, {}, { getToken, refreshToken });
      const data: WaiterResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'conversations unavailable');
      return pick(data);
    },
  });
}

export default function ConversationsPage(): JSX.Element {
  const { has } = usePermissions();
  const { data: tenant } = useTenant();
  const { activeLocationId } = useScope();
  const [params, setParams] = useSearchParams();
  const sub = tenant?.subdomain;
  const allowed = has('conversations:read');
  const days = Number(params.get('days')) || 7;
  const selected = params.get('session');

  const setParam = (k: string, v: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );

  const listPath =
    `/conversations?tenant=${encodeURIComponent(sub ?? '')}&days=${days}` +
    (activeLocationId ? `&location=${encodeURIComponent(activeLocationId)}` : '');
  const list = useWaiterGet<ConversationSummary[]>(
    ['ai-conversations', sub, days, activeLocationId],
    listPath,
    !!sub && allowed,
    (d) => d.conversations ?? [],
  );
  const detail = useWaiterGet<Turn[]>(
    ['ai-conversation', sub, selected],
    `/conversations?tenant=${encodeURIComponent(sub ?? '')}&session=${encodeURIComponent(selected ?? '')}`,
    !!sub && allowed && !!selected,
    (d) => d.turns ?? [],
  );

  const current = useMemo(() => list.data?.find((c) => convoId(c) === selected), [list.data, selected]);

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6 text-sm text-slate-600">
        AI conversations are visible to the restaurant's owners and admins only.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[18px] font-semibold text-slate-900">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-slate-600" />
            AI Conversations
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            What the AI waiter heard, what it understood and what it said. Each session is one guest's visit (a new one starts after 30 minutes of quiet), the latest at the top. Kept for 30 days.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-[#dbdbdb] bg-white p-0.5 text-[13px]">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setParam('days', String(d.value))}
              className={`rounded px-3 py-1.5 ${
                days === d.value ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* the list narrow, the session wide — the session must stay readable with the setup guide open */}
      <div className="mt-6 grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        {/* conversations */}
        <div className="max-h-[calc(100vh-180px)] min-w-0 overflow-y-auto rounded-lg border border-[#ececec] bg-white shadow-sm">
          {list.isLoading && <div className="m-4 h-40 animate-pulse rounded-md bg-slate-100" />}
          {list.isError && <p className="p-4 text-sm text-slate-500">Conversations aren't available right now.</p>}
          {list.data && list.data.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              No conversations in this period — they appear here as guests talk to the AI waiter.
            </p>
          )}
          <ul>
            {list.data?.map((c, i) => (
              <li key={convoId(c)}>
                {/* the latest first, under its day ("Today", "Yesterday", "Fri, Oct 17") */}
                {(i === 0 || dayOf(list.data![i - 1].lastAt) !== dayOf(c.lastAt)) && (
                  <div className="sticky top-0 z-10 border-b border-[#f2f2f2] bg-slate-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
                    {dayLabel(c.lastAt)}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setParam('session', convoId(c))}
                  className={`block w-full border-b border-[#f2f2f2] px-4 py-3 text-left transition ${
                    convoId(c) === selected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
                    <span className="truncate">{where(c)}</span>
                    <span className="shrink-0 tabular-nums">{span(c)}</span>
                  </div>
                  <div className="mt-1 truncate text-[14px] text-slate-900">
                    {c.preview || <span className="italic text-slate-400">Nothing heard clearly</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                    <Chip>{c.turns} {c.turns === 1 ? 'turn' : 'turns'}</Chip>
                    {c.ordered && <Chip tone="green">Ordered</Chip>}
                    {c.unheard > 0 && <Chip tone="amber">{c.unheard} not heard</Chip>}
                    {c.flagged - c.unheard > 0 && <Chip tone="amber">{c.flagged - c.unheard} corrected</Chip>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* one session */}
        <div className="min-w-0">
          {!selected && (
            <div className="rounded-lg border border-dashed border-[#dbdbdb] p-10 text-center text-sm text-slate-500">
              Pick a session to read it turn by turn.
            </div>
          )}
          {selected && (
            <>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-slate-900">
                  {current ? where(current) : 'Session'}
                  {current && (
                    <span className="ml-2 font-normal text-slate-500">
                      {dayLabel(current.startedAt)}, {span(current)} · {current.turns} {current.turns === 1 ? 'turn' : 'turns'}
                      {current.language ? ` · ${LANG_LABEL[current.language] ?? current.language}` : ''}
                    </span>
                  )}
                </h2>
                <span className="font-mono text-[11px] text-slate-400" title="Session id">
                  {selected.slice(0, 8)}
                </span>
              </div>
              {detail.isLoading && <div className="h-40 animate-pulse rounded-md bg-slate-100" />}
              {detail.isError && <p className="text-sm text-slate-500">This session isn't available.</p>}
              {detail.data && detail.data.length === 0 && (
                <p className="text-sm text-slate-500">Nothing stored for this session (older than 30 days?).</p>
              )}
              <ol className="space-y-3">
                {detail.data?.map((t, i) => <TurnCard key={i} turn={t} sub={sub ?? ''} />)}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TurnCard({ turn: t, sub }: { turn: Turn; sub: string }) {
  const u = t.understood;
  const understoodBits = [
    u.intent && words(u.intent),
    u.topic && u.topic !== 'other' && words(u.topic),
    u.language && (LANG_LABEL[u.language] ?? u.language),
  ].filter(Boolean) as string[];
  return (
    <li className="rounded-lg border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>{clock(t.at)}</span>
        {t.flags.length > 0 && (
          <span className="flex flex-wrap justify-end gap-1">
            {t.flags.map((f) => (
              <Chip key={f} tone="amber" title="The waiter's safety net stepped in on this turn">
                {FLAG_LABEL[f] ?? words(f)}
              </Chip>
            ))}
          </span>
        )}
      </div>

      <Row
        icon={t.input === 'typed' ? PencilSquareIcon : MicrophoneIcon}
        label={t.input === 'typed' ? 'Typed' : 'Heard'}
      >
        {t.unheard ? (
          <span className="italic text-slate-400">Nothing it could understand — it asked the guest to say it again</span>
        ) : (
          <span className="text-slate-900">{t.heard}</span>
        )}
        {t.audio && <VoiceClip id={t.audio} sub={sub} />}
      </Row>

      {!t.unheard && (
        <Row icon={CpuChipIcon} label="Understood">
          <div className="space-y-1.5">
            {u.text && (
              <div className="text-slate-700">
                <span className="text-slate-400">Read as </span>“{u.text}”
              </div>
            )}
            {u.corrections.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                {u.corrections.map((c, i) => (
                  <span key={i} className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-600 ring-1 ring-[#ececec]">
                    {c.from} → <span className="font-medium text-slate-800">{c.to}</span>
                  </span>
                ))}
              </div>
            )}
            {understoodBits.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {understoodBits.map((b) => (
                  <Chip key={b}>{b}</Chip>
                ))}
              </div>
            )}
            {u.actions.length > 0 && (
              <ul className="text-[13px] text-slate-800">
                {u.actions.map((a, i) => (
                  <li key={i}>• {actionText(a)}</li>
                ))}
              </ul>
            )}
            {u.serviceRequest && (
              <div className="text-[13px] text-slate-800">
                • Called staff: {words(u.serviceRequest.type)}
                {u.serviceRequest.note ? ` — ${u.serviceRequest.note}` : ''}
              </div>
            )}
            {u.orderPlaced && (
              <div className="text-[13px] font-medium text-emerald-700">
                • Placed the order{u.orderNumber != null ? ` #${u.orderNumber}` : ''}
              </div>
            )}
            {u.suggested.length > 0 && (
              <div className="text-[12px] text-slate-500">Suggested: {u.suggested.join(', ')}</div>
            )}
            {u.mentioned.length > 0 && u.actions.length === 0 && (
              <div className="text-[12px] text-slate-500">About: {u.mentioned.join(', ')}</div>
            )}
          </div>
        </Row>
      )}

      <Row icon={SpeakerWaveIcon} label="Said">
        <span className="text-slate-900">{t.said || <span className="italic text-slate-400">No reply</span>}</span>
      </Row>
    </li>
  );
}

/** "▶ Listen": the guest's own voice for this turn, fetched with the staff login (an <audio> tag can't send it). */
function VoiceClip({ id, sub }: { id: string; sub: string }) {
  const { getToken, refreshToken } = useAuthContext();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'gone'>('idle');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (url) return <audio controls autoPlay src={url} className="mt-1.5 block h-8 w-full max-w-xs" />;
  if (state === 'gone') return <span className="ml-2 text-xs italic text-slate-400">recording no longer kept</span>;
  return (
    <button
      type="button"
      disabled={state === 'loading'}
      onClick={async () => {
        setState('loading');
        try {
          const res = await waiterFetch(
            `/voice-clip?tenant=${encodeURIComponent(sub)}&id=${encodeURIComponent(id)}`,
            {},
            { getToken, refreshToken },
          );
          if (!res.ok) throw new Error(String(res.status));
          setUrl(URL.createObjectURL(await res.blob()));
        } catch {
          setState('gone');
        }
      }}
      className="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {state === 'loading' ? '…' : '▶ Listen'}
    </button>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[#f5f5f5] py-2 text-[14px]">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function Chip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone?: 'green' | 'amber';
  title?: string;
}) {
  const cls =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-100'
        : 'bg-slate-50 text-slate-600 ring-[#ececec]';
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 ring-1 ${cls}`}>
      {children}
    </span>
  );
}

function actionText(a: Action): string {
  const dish = [a.quantity && a.op !== 'remove' ? `${a.quantity} ×` : '', a.name, a.variant ? `(${a.variant})` : '']
    .filter(Boolean)
    .join(' ');
  switch (a.op) {
    case 'add':
      return `Added ${dish}`;
    case 'remove':
      return `Removed ${dish}`;
    case 'set':
      return `Changed to ${dish}`;
    case 'sub':
      return `Took off ${dish}`;
    case 'edit':
      return `Changed ${dish}${a.note ? ` — note: ${a.note}` : ''}`;
    case 'note':
      return `Note on ${a.name}: ${a.note || '(removed)'}`;
    case 'clear':
      return 'Emptied the tray';
    default:
      return `${a.op} ${dish}`;
  }
}

function where(c: ConversationSummary): string {
  const parts = [
    c.table ? `Table ${c.table}` : c.channel === 'online' ? 'Online' : c.channel === 'dine-in' ? 'Dine-in' : 'Guest',
    c.branch,
  ];
  return parts.filter(Boolean).join(' · ');
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toDateString();

/** "Today" / "Yesterday" / "Fri, Oct 17" — the list's day headings. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A session's time: "2:14 PM" (one turn), "2:14 – 2:21 PM · 7 min". */
function span(c: ConversationSummary): string {
  const a = time(c.startedAt);
  const b = time(c.lastAt);
  if (a === b) return a;
  const mins = Math.max(1, Math.round(c.minutes ?? (new Date(c.lastAt).getTime() - new Date(c.startedAt).getTime()) / 60000));
  return `${a} – ${b} · ${mins} min`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
