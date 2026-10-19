// apps/cortex/src/pages/Conversations.tsx — every AI waiter session on the platform (one guest's visit at one branch,
// until 30 minutes of quiet), the latest at the top under its day; searchable by what was said; open one to read it
// turn by turn.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ConversationItem, type TenantRow, type Turn } from '../api';
import { Badge, Card, DaysSelect, Empty, ErrorBox, Loading, fmt } from '../components/ui';
import Turns from '../components/Turns';

export default function Conversations() {
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const tenant = params.get('tenant') ?? '';
  const open = params.get('open');
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const qs = new URLSearchParams({ days: String(days), limit: '200', ...(tenant ? { tenant } : {}), ...(q ? { q } : {}) });
  const list = useQuery({ queryKey: ['conversations', qs.toString()], refetchInterval: 15_000, queryFn: () => api<{ items: ConversationItem[] }>(`/conversations?${qs}`) });
  const detail = useQuery({
    queryKey: ['conversation', open],
    enabled: !!open,
    refetchInterval: 5_000, // a guest may still be talking
    queryFn: () => api<{ turns: Turn[] }>(`/conversations/${encodeURIComponent(open ?? '')}`),
  });
  const current = list.data?.items.find((c) => c.id === open);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-stone-900">AI conversations</h1>
          <p className="text-[13px] text-stone-500">What the AI waiter heard, understood and said — every restaurant, dine-in and online. Each session is one guest's visit (a new one starts after 30 minutes of quiet), the latest at the top.</p>
        </div>
        <DaysSelect value={days} onChange={setDays} />
      </header>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <select value={tenant} onChange={(e) => set('tenant', e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">All restaurants</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search what guests or the waiter said"
          className="w-72 max-w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-stone-500"
        />
        <button type="submit" className="rounded-lg bg-stone-900 px-3 py-2 text-[13px] text-white">
          Search
        </button>
      </form>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            {list.data.items.length ? (
              <ul className="-m-5 divide-y divide-stone-100">
                {list.data.items.map((c, i) => (
                  <li key={c.id}>
                    {(i === 0 || dayOf(list.data.items[i - 1].lastAt) !== dayOf(c.lastAt)) && (
                      <div className="bg-stone-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{dayLabel(c.lastAt)}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => set('open', c.id)}
                      className={`block w-full px-4 py-3 text-left ${c.id === open ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                    >
                      <div className="flex justify-between gap-2 text-[12px] text-stone-500">
                        <span className="truncate">
                          {c.restaurant}
                          {c.branch ? ` · ${c.branch}` : ''} · {c.channel === 'dine-in' ? `table ${c.table ?? '?'}` : 'online'}
                        </span>
                        <span className="shrink-0 tabular-nums">{span(c)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[14px] text-stone-900">{c.preview || '…'}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{c.turns} {c.turns === 1 ? 'turn' : 'turns'}</Badge>
                        {c.language && <Badge>{c.language}</Badge>}
                        {c.ordered && <Badge tone="good">ordered</Badge>}
                        {c.unheard > 0 && <Badge tone="warn">{c.unheard} not heard</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No sessions match.</Empty>
            )}
          </Card>
          <Card
            title={current ? `${current.restaurant}${current.branch ? ` · ${current.branch}` : ''}` : 'Session'}
            subtitle={current ? `${current.channel === 'dine-in' ? `Table ${current.table ?? '?'}` : 'Online'} · ${dayLabel(current.startedAt)}, ${span(current)} · ${current.turns} ${current.turns === 1 ? 'turn' : 'turns'}` : open ? '' : 'Pick one on the left'}
            right={current?.tenantId ? <Link to={`/restaurants/${current.tenantId}`} className="text-[13px] underline">restaurant</Link> : undefined}
          >
            {open ? detail.isLoading ? <Loading /> : detail.data ? <Turns turns={detail.data.turns} /> : detail.error ? <ErrorBox error={detail.error} /> : null : (
              <p className="text-[13px] text-stone-500">Pick a session to read it turn by turn.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
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
function span(c: ConversationItem): string {
  const a = time(c.startedAt);
  const b = time(c.lastAt);
  return a === b ? a : `${a} – ${b} · ${Math.max(1, Math.round(c.minutes))} min`;
}
