// apps/cortex/src/pages/Pronunciation.tsx — Qravy's pronunciation dictionary: ONE for every restaurant's AI waiter.
// A word the Bangla voice says wrong is fixed once and every waiter says it that way from then on. Only Qravy changes
// it: restaurants send requests from their Settings → AI Waiter, reviewed here first (accept as sent, accept with an
// edit, or decline with a note they see). Below: every word, who fixed it and when, and its history (revert a bad change).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Card, ErrorBox, Loading } from '../components/ui';

type Actor = { kind: 'qravy' | 'restaurant'; tenantId?: string; tenantName?: string; by?: string; requestedBy?: { tenantId: string; tenantName: string } };
type Change = { sayAs: string; spoken: string; at: string; actor: Actor; action: string };
type Entry = { _id: string; word: string; sayAs: string; spoken: string; removed?: boolean; actor: Actor; updatedAt: string; history: Change[] };
type Request = {
  _id: string;
  word: string;
  sayAs: string;
  spoken: string;
  note?: string;
  tenantName: string;
  by: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  final?: { sayAs: string; spoken: string };
  reply?: string;
  current: { sayAs: string; spoken: string; actor: Actor } | null;
  /** a hint, not a request: the restaurant already says it this way (its own words) and never sees this */
  hint?: boolean;
  source?: string;
};

const VOICES = { female: 'bn-BD-NabanitaNeural', male: 'bn-BD-PradeepNeural' } as const;

async function spokenFor(sayAs: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(`/api/v1/public/pronounce?text=${encodeURIComponent(sayAs)}`, { signal });
  return r.ok ? String((await r.json())?.spoken ?? '') : '';
}

async function speak(voice: string, text: string): Promise<HTMLAudioElement> {
  const t = await fetch('/api/azure/speech-token').then((r) => r.json());
  if (!t?.token || !t?.region) throw new Error('speech unavailable');
  const r = await fetch(`https://${t.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
    body: `<speak version="1.0" xml:lang="bn-BD"><voice name="${voice}">${text.replace(/[<&>"']/g, ' ')}</voice></speak>`,
  });
  if (!r.ok) throw new Error('speech failed');
  const a = new Audio(URL.createObjectURL(await r.blob()));
  await a.play();
  return a;
}

const who = (a: Actor) =>
  a.kind === 'qravy'
    ? `Qravy${a.by ? ` (${a.by})` : ''}${a.requestedBy ? ` · asked by ${a.requestedBy.tenantName || 'a restaurant'}` : ''}`
    : a.tenantName || 'a restaurant';
const when = (d: string) => new Date(d).toLocaleString();

function useSpoken(sayAs: string) {
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    if (!sayAs.trim()) return setSpoken('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => spokenFor(sayAs, ctl.signal).then(setSpoken).catch(() => undefined), 250);
    return () => (ctl.abort(), window.clearTimeout(id));
  }, [sayAs]);
  return spoken;
}

/** One restaurant's request: hear what they asked vs what it is now, edit it if needed, accept or decline. */
function RequestRow({ r, play, onDone }: { r: Request; play: (text: string) => void; onDone: () => Promise<unknown> }) {
  const [sayAs, setSayAs] = useState(r.sayAs);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const spoken = useSpoken(sayAs);
  const edited = sayAs.trim() !== r.sayAs;
  const decide = async (what: 'accept' | 'decline') => {
    setBusy(true);
    setError('');
    try {
      await api(`/pronunciations/requests/${r._id}/${what}`, { method: 'POST', body: JSON.stringify({ sayAs: sayAs.trim(), reply: reply.trim() }) });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="py-2.5 pr-3">
        <div className="font-medium text-stone-900">{r.word}</div>
        <div className="text-[11px] text-stone-500">
          {r.tenantName || 'a restaurant'}
          {r.by ? ` · ${r.by}` : ''}
        </div>
        <div className="text-[11px] text-stone-400">{when(r.createdAt)}</div>
        {r.note && <div className="mt-1 max-w-[220px] text-[12px] text-stone-600">“{r.note}”</div>}
        {r.hint && (
          <div className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800" title="They changed it for their own restaurant (it already applies there). A clue for the dictionary — they never see this.">
            hint · already applied for them{r.source ? ` (${r.source})` : ""}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3">
        {r.current ? (
          <button type="button" onClick={() => play(r.current!.spoken)} className="text-left">
            <span className="text-[14px] font-medium text-stone-900">▶ {r.current.spoken}</span> <span className="text-stone-400">({r.current.sayAs})</span>
          </button>
        ) : (
          <button type="button" onClick={() => play(r.word)} className="text-left text-stone-600">
            ▶ new word <span className="text-stone-400">(voice reads it on its own)</span>
          </button>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <button type="button" onClick={() => play(r.spoken)} className="text-left">
          <span className="text-[14px] font-medium text-stone-900">▶ {r.spoken}</span> <span className="text-stone-400">({r.sayAs})</span>
        </button>
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={sayAs}
            maxLength={80}
            onChange={(e) => setSayAs(e.target.value)}
            className="w-32 rounded-md border border-stone-300 px-2 py-1 text-[13px]"
            aria-label={`How to say ${r.word}`}
          />
          <button type="button" onClick={() => play(spoken)} disabled={!spoken} className="text-[14px] font-medium text-stone-900 disabled:opacity-40">
            ▶ {spoken || '—'}
          </button>
        </div>
        {!r.hint && (
        <input
          value={reply}
          maxLength={300}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Note to the restaurant (optional)"
          className="mt-1.5 w-full min-w-[200px] rounded-md border border-stone-300 px-2 py-1 text-[12px]"
        />
        )}
        {error && <p className="mt-1 text-[12px] text-red-700">{error}</p>}
      </td>
      <td className="py-2.5 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1.5 text-[12px]">
          <button type="button" disabled={busy || !spoken} onClick={() => decide('accept')} className="rounded-md bg-stone-900 px-2.5 py-1 text-white disabled:opacity-50">
            {r.hint ? (edited ? 'Add for everyone, my edit' : 'Add for everyone') : edited ? 'Accept with my edit' : 'Accept'}
          </button>
          <button type="button" disabled={busy} onClick={() => decide('decline')} className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50">
            {r.hint ? 'Dismiss' : 'Decline'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Restaurants' requests: the queue (oldest first) and, on a switch, what was decided. */
function Requests({ play }: { play: (text: string) => void }) {
  const qc = useQueryClient();
  const [decided, setDecided] = useState(false);
  const q = useQuery({
    queryKey: ['lexicon-requests', decided],
    queryFn: () => api<{ items: Request[]; pending: number }>(`/pronunciations/requests${decided ? '?status=decided' : ''}`),
    refetchInterval: 30_000,
  });
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['lexicon-requests'] }), qc.invalidateQueries({ queryKey: ['lexicon'] })]);
  const items = q.data?.items ?? [];
  return (
    <Card
      title={`Requests from restaurants${q.data ? ` · ${q.data.pending} waiting` : ''}`}
      subtitle="Nothing changes for any waiter until you accept. Edit how to say it before accepting if theirs isn’t quite right."
      right={
        <div className="flex rounded-md border border-stone-300 text-[12px]">
          <button type="button" onClick={() => setDecided(false)} className={`rounded-l-md px-2.5 py-1 ${!decided ? 'bg-stone-900 text-white' : 'text-stone-700'}`}>
            Waiting
          </button>
          <button type="button" onClick={() => setDecided(true)} className={`rounded-r-md px-2.5 py-1 ${decided ? 'bg-stone-900 text-white' : 'text-stone-700'}`}>
            Decided
          </button>
        </div>
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && !items.length && <p className="text-[13px] text-stone-500">{decided ? 'Nothing decided yet.' : 'No requests waiting.'}</p>}
      {!!items.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="pb-2 pr-3 font-semibold">Word · from</th>
                <th className="pb-2 pr-3 font-semibold">Now</th>
                <th className="pb-2 pr-3 font-semibold">They asked</th>
                <th className="pb-2 pr-3 font-semibold">{decided ? 'Decision' : 'You set'}</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {decided
                ? items.map((r) => (
                    <tr key={r._id} className="border-t border-stone-100 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-stone-900">{r.word}</div>
                        <div className="text-[11px] text-stone-500">{r.tenantName || 'a restaurant'}</div>
                      </td>
                      <td className="py-2 pr-3 text-stone-700">{r.current ? r.current.spoken : '—'}</td>
                      <td className="py-2 pr-3">
                        <button type="button" onClick={() => play(r.spoken)} className="text-left">
                          ▶ {r.spoken} <span className="text-stone-400">({r.sayAs})</span>
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={r.status === 'accepted' ? 'text-emerald-700' : 'text-red-700'}>
                          {r.status === 'accepted' ? (r.final && r.final.spoken !== r.spoken ? `Accepted as ${r.final.spoken}` : 'Accepted') : 'Declined'}
                        </span>
                        {r.reply && <div className="text-[12px] text-stone-500">“{r.reply}”</div>}
                        <div className="text-[11px] text-stone-400">
                          {r.decidedBy ? `${r.decidedBy} · ` : ''}
                          {r.decidedAt ? when(r.decidedAt) : ''}
                        </div>
                      </td>
                      <td />
                    </tr>
                  ))
                : items.map((r) => <RequestRow key={r._id} r={r} play={play} onDone={done} />)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Pronunciation() {
  const qc = useQueryClient();
  const [showRemoved, setShowRemoved] = useState(false);
  const q = useQuery({ queryKey: ['lexicon', showRemoved], queryFn: () => api<{ items: Entry[] }>(`/pronunciations${showRemoved ? '?removed=1' : ''}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['lexicon'] });
  const [voice, setVoice] = useState<string>(VOICES.male);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = async (text: string) => {
    if (!text.trim()) return;
    audio.current?.pause();
    try {
      audio.current = await speak(voice, text);
    } catch {
      setError('Could not play it');
    }
  };

  // add / change a word
  const [word, setWord] = useState('');
  const [sayAs, setSayAs] = useState('');
  const spoken = useSpoken(sayAs);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (w: string, s: string) => run(() => api('/pronunciations', { method: 'PUT', body: JSON.stringify({ word: w, sayAs: s }) }));

  // editing one row
  const [edit, setEdit] = useState<{ id: string; sayAs: string } | null>(null);
  const editSpoken = useSpoken(edit?.sayAs ?? '');
  const [open, setOpen] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [byFilter, setByFilter] = useState<'all' | 'qravy' | 'restaurant'>('all');
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter(
      (e) =>
        (byFilter === 'all' || (byFilter === 'restaurant') === (e.actor.kind === 'restaurant' || !!e.actor.requestedBy)) &&
        (!s || e.word.toLowerCase().includes(s) || e.sayAs.toLowerCase().includes(s) || (e.actor.tenantName ?? '').toLowerCase().includes(s))
    );
  }, [q.data, search, byFilter]);
  const existing = (q.data?.items ?? []).find((e) => e._id === word.trim().replace(/\s+/g, ' ').toLowerCase() && !e.removed);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold text-stone-900">Pronunciation</h1>
        <p className="max-w-3xl text-[13px] text-stone-500">
          One dictionary for every restaurant’s AI waiter, changed only here. A word fixed here is said that way by every waiter from then on;
          restaurants ask for fixes from their Settings → AI Waiter and you review them first. Type how to say it in English letters the way
          Bangladeshis type Bangla (<b>sholo</b>, <b>kacchi</b>; every letter is said; capitals <b>T D N R Sh</b> for ট ড ণ ড় ষ) or in Bangla.
        </p>
      </header>

      <Requests play={play} />

      <Card title="Fix a word for every restaurant">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="grid gap-1 text-[12px] text-stone-600">
            Word
            <input value={word} maxLength={60} onChange={(e) => setWord(e.target.value)} placeholder="ষোল  or  Sholo" className="rounded-md border border-stone-300 px-2 py-1.5 text-[13px] text-stone-900" />
          </label>
          <label className="grid gap-1 text-[12px] text-stone-600">
            Say it like
            <input value={sayAs} maxLength={80} onChange={(e) => setSayAs(e.target.value)} placeholder="sholo" className="rounded-md border border-stone-300 px-2 py-1.5 text-[13px] text-stone-900" />
          </label>
          <button
            type="button"
            disabled={busy || !word.trim() || !spoken}
            onClick={() => save(word, sayAs).then(() => (setWord(''), setSayAs('')))}
            className="rounded-md bg-stone-900 px-4 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            {existing ? 'Change for everyone' : 'Save for everyone'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-stone-600">
          <span>
            Voice reads: <b className="text-[14px] text-stone-900">{spoken || '—'}</b>
          </span>
          {existing && (
            <span className="text-stone-500">
              Now: {existing.spoken} (by {who(existing.actor)}) — saving replaces it; the old one stays in its history.
            </span>
          )}
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => play(word)} disabled={!word.trim()} className="rounded-md border border-stone-300 bg-white px-2 py-1 disabled:opacity-40">
              ▶ Now
            </button>
            <button type="button" onClick={() => play(spoken)} disabled={!spoken} className="rounded-md border border-stone-300 bg-white px-2 py-1 disabled:opacity-40">
              ▶ Fixed
            </button>
          </span>
        </div>
        {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
      </Card>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <Card
          title={`${items.length} word${items.length === 1 ? '' : 's'}`}
          right={
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search word or restaurant" className="w-52 rounded-md border border-stone-300 px-2 py-1" />
              <select value={byFilter} onChange={(e) => setByFilter(e.target.value as typeof byFilter)} className="rounded-md border border-stone-300 bg-white px-2 py-1">
                <option value="all">Everyone’s</option>
                <option value="qravy">Qravy’s</option>
                <option value="restaurant">Asked by restaurants</option>
              </select>
              <label className="flex items-center gap-1 text-stone-600">
                <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> removed
              </label>
              <select value={voice} onChange={(e) => setVoice(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1" aria-label="Voice to listen with">
                <option value={VOICES.male}>male voice</option>
                <option value={VOICES.female}>female voice</option>
              </select>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="pb-2 pr-3 font-semibold">Word</th>
                  <th className="pb-2 pr-3 font-semibold">Voice reads</th>
                  <th className="pb-2 pr-3 font-semibold">Fixed by</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <Fragment key={e._id}>
                    <tr className={`border-t border-stone-100 align-top ${e.removed ? 'opacity-50' : ''}`}>
                      <td className="py-2 pr-3 font-medium text-stone-900">{e.word}</td>
                      <td className="py-2 pr-3">
                        {edit?.id === e._id ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              value={edit.sayAs}
                              onChange={(ev) => setEdit({ id: e._id, sayAs: ev.target.value })}
                              className="w-36 rounded-md border border-stone-300 px-2 py-1 text-[13px]"
                              aria-label={`How to say ${e.word}`}
                            />
                            <span className="text-[14px] font-medium">{editSpoken || '—'}</span>
                          </div>
                        ) : (
                          <>
                            <span className="text-[14px] font-medium text-stone-900">{e.spoken}</span> <span className="text-stone-400">({e.sayAs})</span>
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-stone-600">
                        {who(e.actor)}
                        <div className="text-[11px] text-stone-400">{when(e.updatedAt)}</div>
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5 text-[12px]">
                          <button type="button" onClick={() => play(e.word)} className="rounded-md border border-stone-300 bg-white px-2 py-1">
                            ▶ Now
                          </button>
                          <button type="button" onClick={() => play(edit?.id === e._id ? editSpoken : e.spoken)} className="rounded-md border border-stone-300 bg-white px-2 py-1">
                            ▶ Fixed
                          </button>
                          {edit?.id === e._id ? (
                            <>
                              <button
                                type="button"
                                disabled={busy || !editSpoken}
                                onClick={() => save(e.word, edit.sayAs).then(() => setEdit(null))}
                                className="rounded-md bg-stone-900 px-2 py-1 text-white disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button type="button" onClick={() => setEdit(null)} className="rounded-md px-2 py-1 text-stone-600 hover:bg-stone-50">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setEdit({ id: e._id, sayAs: e.sayAs })} className="rounded-md px-2 py-1 font-medium text-stone-800 hover:bg-stone-50">
                              {e.removed ? 'Bring back' : 'Change'}
                            </button>
                          )}
                          <button type="button" onClick={() => setOpen(open === e._id ? null : e._id)} disabled={!e.history.length} className="rounded-md px-2 py-1 text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                            History ({e.history.length})
                          </button>
                          {!e.removed && (
                            <button
                              type="button"
                              onClick={() =>
                                window.confirm(`Remove “${e.word}”? Every waiter goes back to reading it on its own.`) &&
                                run(() => api(`/pronunciations/${encodeURIComponent(e.word)}`, { method: 'DELETE' }))
                              }
                              className="rounded-md px-2 py-1 text-red-700 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === e._id && (
                      <tr className="bg-stone-50/70">
                        <td colSpan={4} className="px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-semibold text-stone-700">Before (newest first)</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(() => api('/pronunciations/revert', { method: 'POST', body: JSON.stringify({ word: e.word }) }))}
                              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[12px] font-medium"
                            >
                              ↶ Go back to the previous one
                            </button>
                          </div>
                          <ul className="mt-1.5 space-y-1 text-[12px] text-stone-600">
                            {[...e.history].reverse().map((h, i) => (
                              <li key={i} className="flex flex-wrap gap-x-3">
                                <b className="text-[13px] text-stone-900">{h.spoken}</b>
                                <span>({h.sayAs})</span>
                                <span>by {who(h.actor)}</span>
                                <span className="text-stone-400">{when(h.at)}</span>
                                <button type="button" onClick={() => play(h.spoken)} className="text-stone-700 underline">
                                  ▶
                                </button>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && <p className="py-3 text-[13px] text-stone-500">No words{search ? ' match' : ' yet'}.</p>}
        </Card>
      )}
    </div>
  );
}
