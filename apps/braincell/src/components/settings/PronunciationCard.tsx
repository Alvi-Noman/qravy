// apps/braincell/src/components/settings/PronunciationCard.tsx — Settings → AI Waiter → Pronunciation.
// Qravy's pronunciation dictionary is ONE for every restaurant: a word the voice says wrong ("ষোল" read "shol") is fixed
// once ("sholo") and every restaurant's waiter says it that way from then on. Only Qravy changes it — here a restaurant
// asks for a fix (a new word, or a better way to say one), Qravy reviews it in Cortex, and the request shows what
// happened. A live preview shows what the voice will read ("শোলো") and ▶ plays it now vs with the fix.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MagnifyingGlassIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import { useTenant } from '../../hooks/useTenant';
import { listRequests, listWords, requestWord, withdrawRequest, type DictWord, type WordRequest } from '../../api/pronunciations';
import { toastError, toastSuccess } from '../Toaster';
import { speak, spokenFor, VOICES } from '../../utils/speech';

const errorOf = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** "sholo" → "শোলো" as they type (a little after they stop). */
function useSpoken(sayAs: string): string {
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    if (!sayAs.trim()) return setSpoken('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => spokenFor(sayAs, ctl.signal).then(setSpoken).catch(() => undefined), 250);
    return () => {
      ctl.abort();
      window.clearTimeout(id);
    };
  }, [sayAs]);
  return spoken;
}

function usePlayer(voice: string) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const play = async (id: string, text: string) => {
    if (!text.trim()) return;
    audio.current?.pause();
    setPlaying(id);
    try {
      audio.current = await speak(voice, text);
      audio.current.onended = () => setPlaying(null);
    } catch {
      toastError('Could not play it');
      setPlaying(null);
    }
  };
  return { playing, play };
}

const playBtn = (label: string, onClick: () => void, disabled: boolean, busy: boolean) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
  >
    <SpeakerWaveIcon className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
    {label}
  </button>
);

const BADGE: Record<DictWord['by'], { text: string; cls: string }> = {
  qravy: { text: 'Qravy', cls: 'bg-slate-900 text-white' },
  you: { text: 'Your request', cls: 'bg-emerald-50 text-emerald-800' },
  'another restaurant': { text: 'Another restaurant', cls: 'bg-slate-100 text-slate-600' },
};

/** One word of the dictionary: hear it, ask Qravy for a better way to say it. */
function WordRow({ w, voice, pending, onSent }: { w: DictWord; voice: string; pending?: WordRequest; onSent: () => void }) {
  const [editing, setEditing] = useState(false);
  const [sayAs, setSayAs] = useState(w.sayAs);
  const spoken = useSpoken(editing ? sayAs : '');
  const { playing, play } = usePlayer(voice);
  const send = useMutation({
    mutationFn: () => requestWord(w.word, sayAs),
    onSuccess: () => {
      toastSuccess(`Sent to Qravy — “${w.word}” changes once it’s reviewed`);
      setEditing(false);
      onSent();
    },
    onError: (e) => toastError(errorOf(e, 'Could not send it')),
  });

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-[90px] font-medium text-slate-900">{w.word}</span>
        <span className="text-[12px] text-slate-500">
          → <b className="text-[14px] text-slate-900">{editing ? spoken || '—' : w.spoken}</b>
          {!editing && <span className="ml-1 text-slate-400">({w.sayAs})</span>}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[w.by].cls}`}>{BADGE[w.by].text}</span>
        {pending && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">You asked: {pending.spoken}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {playBtn('Now', () => play('now', w.word), !!playing, playing === 'now')}
          {playBtn('Fixed', () => play('fixed', editing ? spoken : w.spoken), !!playing || (editing && !spoken), playing === 'fixed')}
          {!editing && (
            <button
              type="button"
              onClick={() => (setSayAs(pending?.sayAs ?? w.sayAs), setEditing(true))}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Suggest a change
            </button>
          )}
        </span>
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={sayAs}
            maxLength={80}
            onChange={(e) => setSayAs(e.target.value)}
            aria-label={`How to say ${w.word}`}
            className="w-56 rounded-md border border-[#e2e2e2] px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={send.isPending || !spoken || spoken === w.spoken}
            onClick={() => send.mutate()}
            className="rounded-md bg-[#2e2e30] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {send.isPending ? 'Sending…' : 'Send to Qravy'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

const STATUS: Record<WordRequest['status'], { text: string; cls: string }> = {
  pending: { text: 'Waiting for Qravy', cls: 'bg-amber-50 text-amber-800' },
  accepted: { text: 'Added', cls: 'bg-emerald-50 text-emerald-800' },
  declined: { text: 'Declined', cls: 'bg-red-50 text-red-700' },
};

/** The restaurant's requests: waiting (can be taken back), added (maybe as Qravy changed it), declined (with why). */
function RequestsList({ items, voice, onChange }: { items: WordRequest[]; voice: string; onChange: () => void }) {
  const { playing, play } = usePlayer(voice);
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawRequest(id),
    onSuccess: onChange,
    onError: (e) => toastError(errorOf(e, 'Could not take it back')),
  });
  return (
    <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
      {items.map((r) => {
        const edited = r.status === 'accepted' && !!r.final && r.final.spoken !== r.spoken;
        return (
          <li key={r.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="min-w-[90px] font-medium text-slate-900">{r.word}</span>
              <span className="text-[12px] text-slate-500">
                → <b className={`text-[14px] ${edited ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{r.spoken}</b>
                {edited && <b className="ml-1.5 text-[14px] text-slate-900">{r.final?.spoken}</b>}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status].cls}`}>
                {edited ? 'Added with Qravy’s change' : STATUS[r.status].text}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {playBtn('Listen', () => play(r.id, r.final?.spoken ?? r.spoken), !!playing, playing === r.id)}
                {r.status === 'pending' && (
                  <button
                    type="button"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(r.id)}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Take back
                  </button>
                )}
              </span>
            </div>
            {r.reply && <p className="mt-1 text-[12px] text-slate-600">Qravy: “{r.reply}”</p>}
          </li>
        );
      })}
    </ul>
  );
}

export default function PronunciationCard() {
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const voice = tenant?.waiterVoice === 'female' ? VOICES.female : VOICES.male;
  const words = useQuery({ queryKey: ['dictionary'], queryFn: listWords });
  const requests = useQuery({ queryKey: ['dictionary-requests'], queryFn: listRequests });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dictionary'] });
    qc.invalidateQueries({ queryKey: ['dictionary-requests'] });
  };
  const pendingFor = (w: string) => (requests.data ?? []).find((r) => r.status === 'pending' && r.word.toLowerCase() === w.toLowerCase());

  // asking for a new word (or a better way to say one)
  const [word, setWord] = useState('');
  const [sayAs, setSayAs] = useState('');
  const [note, setNote] = useState('');
  const spoken = useSpoken(sayAs);
  const { playing, play } = usePlayer(voice);
  const existing = (words.data ?? []).find((w) => w.word.toLowerCase() === word.trim().toLowerCase());
  const asked = word.trim() ? pendingFor(word.trim()) : undefined;
  const add = useMutation({
    mutationFn: () => requestWord(word.trim(), sayAs.trim(), note.trim()),
    onSuccess: () => {
      toastSuccess(`Sent to Qravy — you’ll see here when “${word.trim()}” is added`);
      setWord('');
      setSayAs('');
      setNote('');
      refresh();
    },
    onError: (e) => toastError(errorOf(e, 'Could not send it')),
  });

  const [q, setQ] = useState('');
  const [shown, setShown] = useState(30);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (words.data ?? []).filter((w) => !s || w.word.toLowerCase().includes(s) || w.sayAs.toLowerCase().includes(s) || w.spoken.includes(q.trim()));
  }, [words.data, q]);
  const waiting = (requests.data ?? []).filter((r) => r.status === 'pending').length;

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Pronunciation</div>
      <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
        Does the voice say a word wrong — your restaurant’s name, a dish? Tell us: type the word as it appears, then how to say it in English
        letters the way you’d type Bangla (<b>sholo</b>, <b>kacchi</b>; every letter is said; capitals <b>T D N R Sh</b> for ট ড ণ ড় ষ) or in Bangla.
        <b> Qravy uses one dictionary for every restaurant</b>, so Qravy reviews each fix before every waiter starts saying it.
      </p>

      {/* ask for a word */}
      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Word</span>
            <input
              value={word}
              maxLength={60}
              onChange={(e) => setWord(e.target.value)}
              placeholder="ষোল  or  Sholo"
              className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Say it like</span>
            <input
              value={sayAs}
              maxLength={80}
              onChange={(e) => setSayAs(e.target.value)}
              placeholder="sholo"
              className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => add.mutate()}
            disabled={add.isPending || !word.trim() || !spoken || spoken === existing?.spoken}
            className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {add.isPending ? 'Sending…' : 'Send to Qravy'}
          </button>
        </div>
        <input
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for Qravy (optional) — e.g. it’s our restaurant’s name"
          aria-label="Note for Qravy"
          className="mt-2 w-full rounded-md border border-[#e2e2e2] px-3 py-1.5 text-[13px]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
          <span>
            Voice reads: <b className="text-[14px] text-slate-900">{spoken || '—'}</b>
          </span>
          {asked ? (
            <span className="text-amber-700">You already asked for {asked.spoken} — sending again replaces that request.</span>
          ) : (
            existing && <span className="text-slate-500">Now said {existing.spoken} — Qravy decides whether to change it.</span>
          )}
          <span className="ml-auto flex gap-2">
            {playBtn('Now', () => play('now', word), !word.trim() || !!playing, playing === 'now')}
            {playBtn('With your fix', () => play('fixed', spoken), !spoken || !!playing, playing === 'fixed')}
          </span>
        </div>
      </div>

      {/* the restaurant's requests */}
      {!!requests.data?.length && (
        <div className="mt-5">
          <div className="text-[13px] font-semibold text-slate-900">
            Your requests <span className="font-normal text-slate-500">· {waiting} waiting</span>
          </div>
          <RequestsList items={requests.data} voice={voice} onChange={refresh} />
        </div>
      )}

      {/* the dictionary */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-slate-900">
          The dictionary <span className="font-normal text-slate-500">· {words.data?.length ?? 0} words</span>
        </div>
        <label className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-48 rounded-md border border-[#e2e2e2] py-1.5 pl-8 pr-2 text-sm" />
        </label>
      </div>
      {words.isLoading ? (
        <p className="mt-3 text-[13px] text-slate-500">Loading…</p>
      ) : list.length ? (
        <>
          <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
            {list.slice(0, shown).map((w) => (
              <WordRow key={w.word} w={w} voice={voice} pending={pendingFor(w.word)} onSent={refresh} />
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 30)} className="mt-2 text-[13px] font-medium text-slate-700 underline">
              Show more ({list.length - shown})
            </button>
          )}
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
          {q ? 'No word matches.' : 'No words yet. For example: ask for ষোল → say it like sholo, so the voice says “sholo”, not “shol”.'}
        </p>
      )}
    </div>
  );
}
