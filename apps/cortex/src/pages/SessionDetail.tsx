// apps/cortex/src/pages/SessionDetail.tsx — one guest visit, step by step: pages, the AI waiter's turns, the order.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type OrderItem, type SessionItem, type Turn } from '../api';
import { Badge, Card, ErrorBox, Loading, Stat, fmt } from '../components/ui';
import Turns from '../components/Turns';

type Detail = {
  session: SessionItem | null;
  events: Array<{ type: string; page: string | null; data: Record<string, unknown> | null; at: string }>;
  turns: Turn[];
  orders: OrderItem[];
};

const LABEL: Record<string, string> = {
  scan: 'Scanned the QR code',
  visit: 'Opened a page',
  waiter_start: 'Tapped “Get started”',
  ai_turn: 'The AI waiter answered',
  suggestions_opened: 'Looked at the AI’s suggestions',
  suggestion_added: 'Added a suggested dish',
  item_added: 'Added to the tray',
  checkout_started: 'Opened checkout',
  order_placed: 'Placed the order',
  call_waiter: 'Called staff',
};

export default function SessionDetail() {
  const { vid } = useParams();
  const q = useQuery({ queryKey: ['session', vid], queryFn: () => api<Detail>(`/sessions/${encodeURIComponent(vid ?? '')}`) });
  const d = q.data;
  const s = d?.session;
  const steps = (d?.events ?? []).filter((e) => e.type !== 'ping');

  return (
    <div className="space-y-6">
      <Link to="/sessions" className="text-[13px] text-stone-500 hover:text-stone-800">
        ← Guest sessions
      </Link>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {d && s && (
        <>
          <header>
            <h1 className="text-[22px] font-semibold text-stone-900">
              <Link to={`/restaurants/${s.tenantId}`} className="hover:underline">
                {s.restaurant}
              </Link>
              {s.branch ? ` · ${s.branch}` : ''}
            </h1>
            <p className="mt-1 text-[13px] text-stone-500">
              {s.channel === 'dine-in' ? `Dine-in, table ${s.table ?? '?'}` : 'Online'} · {s.device} · {fmt.time(s.startedAt)}
            </p>
          </header>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Time" value={fmt.min(s.minutes)} />
            <Stat label="Pages" value={s.pageViews} sub={s.scanned ? 'came from a QR code' : 'opened the link'} />
            <Stat label="AI turns" value={d.turns.length || s.aiTurns} sub={`${s.suggestionsAdded} suggestions taken`} />
            <Stat label="Outcome" value={s.ordered ? 'Ordered' : s.checkout ? 'Left at checkout' : 'No order'} tone={s.checkout && !s.ordered ? 'bad' : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Steps" className="lg:col-span-1">
              <ol className="relative space-y-3 border-l border-stone-200 pl-4">
                {steps.map((e, i) => (
                  <li key={i} className="text-[13px]">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-stone-400" />
                    <div className="text-stone-900">
                      {LABEL[e.type] ?? e.type}
                      {e.page && e.type === 'visit' ? `: ${e.page}` : ''}
                      {e.type === 'order_placed' && e.data?.orderNumber ? ` #${String(e.data.orderNumber)}` : ''}
                    </div>
                    <div className="text-[11px] text-stone-500">{new Date(e.at).toLocaleTimeString('en-GB')}</div>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="AI waiter — heard, understood, said" className="lg:col-span-2">
              <Turns turns={d.turns} />
            </Card>
          </div>

          {d.orders.length > 0 && (
            <Card title="Order">
              {d.orders.map((o) => (
                <div key={o.id} className="text-[13px]">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold">#{o.orderNumber}</span>
                    <Badge tone={o.status === 'cancelled' ? 'bad' : 'good'}>{o.status}</Badge>
                    <span className="text-stone-500">{o.source} · {fmt.money(o.total)}</span>
                  </div>
                  <ul className="space-y-0.5 text-stone-700">
                    {Array.isArray(o.items) &&
                      o.items.map((it, j) => (
                        <li key={j}>
                          {it.qty} × {it.name}
                          {it.variation ? ` (${it.variation})` : ''} — {fmt.money(it.lineTotal)}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
