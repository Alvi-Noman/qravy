// apps/cortex/src/pages/LiveTranscripts.tsx — the AI waiter's turns as they happen, in every restaurant and branch:
// what it heard, what it understood, what it said. Checks for new turns every 2.5 seconds (newest on top).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type TenantRow, type Turn } from '../api';
import { Badge, Card, Empty, ErrorBox, fmt } from '../components/ui';
import VoiceClip from '../components/VoiceClip';

type LiveTurn = Turn & {
  id: string;
  conversationId: string;
  tenantId: string | null;
  restaurant: string;
  subdomain: string | null;
};

const POLL_MS = 2500;
const KEEP = 300; // turns kept on screen

export default function LiveTranscripts() {
  const [tenant, setTenant] = useState('');
  const [location, setLocation] = useState('');
  const [channel, setChannel] = useState('');
  const [paused, setPaused] = useState(false);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const cursor = useRef<string | null>(null);

  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const branches = useQuery({
    queryKey: ['tenant-branches', tenant],
    enabled: !!tenant,
    queryFn: () => api<{ branches: Array<{ id: string; name: string }> }>(`/tenants/${tenant}?days=1`),
  });

  // a new filter starts the feed over
  useEffect(() => {
    cursor.current = null;
    setTurns([]);
  }, [tenant, location, channel]);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const qs = new URLSearchParams({
          ...(cursor.current ? { after: cursor.current } : {}),
          ...(tenant ? { tenant } : {}),
          ...(location ? { location } : {}),
          ...(channel ? { channel } : {}),
        });
        const r = await api<{ cursor: string | null; items: LiveTurn[] }>(`/transcripts/live?${qs}`);
        if (!alive) return;
        if (r.cursor) cursor.current = r.cursor;
        if (r.items.length) setTurns((prev) => [...r.items.slice().reverse(), ...prev].slice(0, KEEP));
        setError(null);
        setLastCheck(new Date());
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [paused, tenant, location, channel]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold text-stone-900">
            Live transcripts
            {!paused && <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" aria-label="live" />}
          </h1>
          <p className="text-[13px] text-stone-500">
            Every AI waiter turn as it happens — what it heard, understood and said. {lastCheck ? `Checked ${lastCheck.toLocaleTimeString('en-GB')}.` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={`rounded-lg px-4 py-2 text-[13px] font-medium ${paused ? 'bg-emerald-600 text-white' : 'border border-stone-300 bg-white text-stone-800'}`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={tenant}
          onChange={(e) => {
            setTenant(e.target.value);
            setLocation('');
          }}
          className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]"
        >
          <option value="">All restaurants</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {tenant && (branches.data?.branches.length ?? 0) > 0 && (
          <select value={location} onChange={(e) => setLocation(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
            <option value="">All branches</option>
            {branches.data!.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-[13px]">
          <option value="">Dine-in and online</option>
          <option value="dine-in">Dine-in</option>
          <option value="online">Online</option>
        </select>
        <span className="text-[12px] text-stone-500">{turns.length} turns on screen (newest {KEEP} kept)</span>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {turns.length === 0 ? (
        <Empty>Waiting for guests to talk to the AI waiter… (the last day&apos;s turns show here first)</Empty>
      ) : (
        <div className="space-y-3">
          {turns.map((t) => (
            <Card key={t.id}>
              <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-1.5 text-stone-600">
                  {t.tenantId ? (
                    <Link to={`/restaurants/${t.tenantId}`} className="font-semibold text-stone-900 hover:underline">
                      {t.restaurant}
                    </Link>
                  ) : (
                    <span className="font-semibold text-stone-900">{t.restaurant}</span>
                  )}
                  {t.branch && <span>· {t.branch}</span>}
                  <span>· {t.channel === 'dine-in' ? `table ${t.table ?? '?'}` : t.channel ?? '—'}</span>
                  <Badge>{t.input}</Badge>
                  {t.understood.language && <Badge>{t.understood.language}</Badge>}
                  {t.understood.intent && <Badge tone="info">{t.understood.intent}</Badge>}
                  {t.unheard && <Badge tone="warn">not heard</Badge>}
                  {t.understood.orderPlaced && <Badge tone="good">order #{t.understood.orderNumber ?? ''} placed</Badge>}
                  {t.flags.map((f) => (
                    <Badge key={f} tone="warn">
                      {f}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-stone-500">
                  <span title={fmt.time(t.at)}>{fmt.ago(t.at)}</span>
                  <Link to={`/conversations?open=${encodeURIComponent(t.conversationId)}`} className="underline">
                    whole conversation
                  </Link>
                </div>
              </div>
              <dl className="grid gap-2 text-[13px] md:grid-cols-[110px_1fr]">
                <dt className="text-stone-500">Heard</dt>
                <dd className="text-stone-900">
                  {t.heard || <span className="italic text-stone-400">(nothing)</span>}
                  {t.audio && <VoiceClip id={t.audio} />}
                </dd>
                {(t.understood.text || t.understood.actions.length > 0 || t.understood.mentioned.length > 0 || t.understood.suggested.length > 0) && (
                  <>
                    <dt className="text-stone-500">Understood</dt>
                    <dd className="space-y-0.5 text-stone-700">
                      {t.understood.text && <div>“{t.understood.text}”</div>}
                      {t.understood.actions.map((a, j) => (
                        <div key={j}>
                          • {a.op} {a.quantity ? `${a.quantity} × ` : ''}
                          {a.name ?? ''}
                          {a.variant ? ` (${a.variant})` : ''}
                        </div>
                      ))}
                      {t.understood.mentioned.length > 0 && <div>About: {t.understood.mentioned.join(', ')}</div>}
                      {t.understood.suggested.length > 0 && <div>Suggested: {t.understood.suggested.join(', ')}</div>}
                    </dd>
                  </>
                )}
                <dt className="text-stone-500">Said</dt>
                <dd className="text-stone-900">{t.said}</dd>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
