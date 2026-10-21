// apps/cortex/src/pages/SpeechToText.tsx — which restaurants' guests ElevenLabs Scribe hears (the others: gpt-4o), and
// the ElevenLabs credits. The AI waiter picks a change up within ~10 s; a failed / slow / out-of-credits ElevenLabs
// turn is heard by gpt-4o instead (ai-waiter-service server.py cloud_transcribe).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SttInfo, type TenantRow } from '../api';
import { Badge, Card, ErrorBox, Loading, fmt } from '../components/ui';

export default function SpeechToText() {
  const qc = useQueryClient();
  const stt = useQuery({ queryKey: ['stt'], queryFn: () => api<SttInfo>('/stt'), refetchInterval: 60_000 });
  const tenants = useQuery({ queryKey: ['tenants', 30], queryFn: () => api<{ items: TenantRow[] }>('/tenants?days=30') });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (stt.data && picked === null) setPicked(new Set(stt.data.elevenlabs));
  }, [stt.data, picked]);
  const save = useMutation({
    mutationFn: (subs: string[]) => api<SttInfo>('/stt', { method: 'PUT', body: JSON.stringify({ elevenlabs: subs }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stt'] }),
  });
  const rows = useMemo(
    () =>
      (tenants.data?.items ?? [])
        .filter((t) => !t.demo)
        .filter((t) => !q || `${t.name} ${t.subdomain}`.toLowerCase().includes(q.toLowerCase())),
    [tenants.data, q],
  );
  if (stt.isLoading || tenants.isLoading) return <Loading />;
  if (stt.error) return <ErrorBox error={stt.error} />;
  const s = stt.data?.status;
  const saved = new Set(stt.data?.elevenlabs ?? []);
  const changed = picked !== null && (picked.size !== saved.size || [...picked].some((x) => !saved.has(x)));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold text-stone-900">Speech-to-text</h1>
        <p className="text-[13px] text-stone-500">
          Which engine hears the guests. Restaurants switched on here use <b>ElevenLabs Scribe</b> (with their menu&apos;s dish names); all others use
          gpt-4o. If ElevenLabs fails, is slow or runs out of credits, that turn is heard by gpt-4o — guests never notice.
        </p>
      </header>

      <Card title="ElevenLabs credits" right={s?.checkedAt ? <span className="text-[12px] text-stone-500">checked {fmt.time(s.checkedAt)}</span> : null}>
        {!s || !s.configured ? (
          <p className="text-[13px] text-stone-600">Not set up — ELEVENLABS_API_KEY isn&apos;t in the AI waiter&apos;s settings (or it hasn&apos;t checked yet).</p>
        ) : (
          <div className="space-y-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              {s.out ? <Badge tone="bad">used up — top up</Badge> : s.low ? <Badge tone="warn">low — top up soon</Badge> : <Badge tone="good">ok</Badge>}
              {s.tier && <Badge>{s.tier}</Badge>}
              {s.model && <Badge tone="info">{s.model}</Badge>}
            </div>
            {s.limit !== null && s.left !== null && (
              <>
                <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={`h-full ${s.out ? 'bg-red-500' : s.low ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${s.limit ? Math.min(100, (100 * (s.used ?? 0)) / s.limit) : 0}%` }}
                  />
                </div>
                <div className="text-stone-700">
                  <b>{(s.left ?? 0).toLocaleString()}</b> credits left of {(s.limit ?? 0).toLocaleString()} (roughly {Math.round((s.left ?? 0) / 60)} minutes of audio, at about a credit a second)
                  {s.resetsAt ? ` · renews ${fmt.date(s.resetsAt)}` : ''}
                </div>
              </>
            )}
            {s.error && <div className="text-[12px] text-red-600">Couldn&apos;t check: {s.error}</div>}
          </div>
        )}
      </Card>

      <Card
        title="Restaurants on ElevenLabs"
        subtitle={`${saved.size} on now`}
        right={
          <button
            type="button"
            disabled={!changed || save.isPending}
            onClick={() => picked && save.mutate([...picked])}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        }
      >
        {save.error && <ErrorBox error={save.error} />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search restaurants…"
          className="mb-3 w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-[13px]"
        />
        <ul className="divide-y divide-stone-100">
          {rows.map((t) => {
            const on = picked?.has(t.subdomain) ?? false;
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-stone-900">{t.name}</div>
                  <div className="text-[12px] text-stone-500">{t.subdomain}</div>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-stone-700">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const n = new Set(picked ?? []);
                      if (on) n.delete(t.subdomain);
                      else n.add(t.subdomain);
                      setPicked(n);
                    }}
                  />
                  ElevenLabs
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
