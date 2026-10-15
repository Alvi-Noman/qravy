// apps/braincell/src/components/settings/PronunciationCard.tsx — Settings → AI Waiter → Pronunciation.
// A word the voice says wrong ("ষোল" read "shol") is fixed by asking Qravy: the restaurant sends how to say it
// ("sholo"), Qravy reviews it in Cortex, and once approved the fix is used by every waiter on Qravy. Here a restaurant
// sees only its own words — waiting for approval, approved (maybe as Qravy changed it) or declined — never the whole
// dictionary or other restaurants' words. A live preview shows what the voice will read ("শোলো") and ▶ plays it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SpeakerWaveIcon } from '@heroicons/react/24/outline';
import { useTenant } from '../../hooks/useTenant';
import { listRequests, listWords, requestWord, withdrawRequest } from '../../api/pronunciations';
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

type Status = 'pending' | 'approved' | 'changed' | 'declined';
const STATUS: Record<Status, { text: string; cls: string }> = {
  pending: { text: 'Waiting for approval', cls: 'bg-amber-50 text-amber-800' },
  approved: { text: 'Approved', cls: 'bg-emerald-50 text-emerald-800' },
  changed: { text: 'Approved with Qravy’s change', cls: 'bg-emerald-50 text-emerald-800' },
  declined: { text: 'Declined', cls: 'bg-red-50 text-red-700' },
};

/** One of the restaurant's words: a request (any status), or an approved word from before requests existed. */
type Row = {
  key: string;
  requestId?: string;
  word: string;
  /** what the voice says (Qravy's version when it changed it) */
  spoken: string;
  /** what the restaurant asked for, when Qravy changed it */
  asked?: string;
  sayAs: string;
  status: Status;
  reply?: string;
};

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

  // the restaurant's words: its requests (newest first), then its approved words that have no request
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (requests.data ?? []).map((r) => {
      const changed = r.status === 'accepted' && !!r.final && r.final.spoken !== r.spoken;
      return {
        key: r.id,
        requestId: r.id,
        word: r.word,
        spoken: r.final?.spoken ?? r.spoken,
        asked: changed ? r.spoken : undefined,
        sayAs: r.final?.sayAs ?? r.sayAs,
        status: r.status === 'pending' ? 'pending' : r.status === 'declined' ? 'declined' : changed ? 'changed' : 'approved',
        reply: r.reply || undefined,
      };
    });
    const asked = new Set(out.map((r) => r.word.toLowerCase()));
    for (const w of words.data ?? []) {
      if (!asked.has(w.word.toLowerCase())) out.push({ key: `w:${w.word}`, word: w.word, spoken: w.spoken, sayAs: w.sayAs, status: 'approved' });
    }
    return out;
  }, [requests.data, words.data]);
  const waiting = rows.filter((r) => r.status === 'pending').length;

  // asking for a word (a new one, or a better way to say one of theirs)
  const [word, setWord] = useState('');
  const [sayAs, setSayAs] = useState('');
  const [note, setNote] = useState('');
  const spoken = useSpoken(sayAs);
  const { playing, play } = usePlayer(voice);
  const asked = word.trim() ? rows.find((r) => r.status === 'pending' && r.word.toLowerCase() === word.trim().toLowerCase()) : undefined;
  const add = useMutation({
    mutationFn: () => requestWord(word.trim(), sayAs.trim(), note.trim()),
    onSuccess: () => {
      toastSuccess(`Sent to Qravy — “${word.trim()}” shows as approved here once it’s reviewed`);
      setWord('');
      setSayAs('');
      setNote('');
      refresh();
    },
    onError: (e) => toastError(errorOf(e, 'Could not send it')),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawRequest(id),
    onSuccess: refresh,
    onError: (e) => toastError(errorOf(e, 'Could not take it back')),
  });
  const form = useRef<HTMLDivElement | null>(null);
  const improve = (r: Row) => {
    setWord(r.word);
    setSayAs(r.sayAs);
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Pronunciation</div>
      <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
        Does the voice say a word wrong — your restaurant’s name, a dish? Tell us: type the word as it appears, then how to say it in English
        letters the way you’d type Bangla (<b>sholo</b>, <b>kacchi</b>; every letter is said; capitals <b>T D N R Sh</b> for ট ড ণ ড় ষ) or in Bangla.
        Qravy reviews it, and once it’s approved your waiter says it that way.
      </p>

      {/* ask for a word */}
      <div ref={form} className="mt-4 rounded-lg border border-slate-200 p-3">
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
            disabled={add.isPending || !word.trim() || !spoken}
            className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {add.isPending ? 'Sending…' : 'Send for approval'}
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
          {asked && <span className="text-amber-700">Already waiting for approval as {asked.spoken} — sending again replaces it.</span>}
          <span className="ml-auto flex gap-2">
            {playBtn('Now', () => play('now', word), !word.trim() || !!playing, playing === 'now')}
            {playBtn('With your fix', () => play('fixed', spoken), !spoken || !!playing, playing === 'fixed')}
          </span>
        </div>
      </div>

      {/* the restaurant's words */}
      <div className="mt-5 text-[13px] font-semibold text-slate-900">
        Your words{' '}
        <span className="font-normal text-slate-500">
          · {rows.length}
          {waiting ? ` · ${waiting} waiting for approval` : ''}
        </span>
      </div>
      {words.isLoading || requests.isLoading ? (
        <p className="mt-3 text-[13px] text-slate-500">Loading…</p>
      ) : rows.length ? (
        <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
          {rows.map((r) => (
            <li key={r.key} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="min-w-[90px] font-medium text-slate-900">{r.word}</span>
                <span className="text-[12px] text-slate-500">
                  {r.asked && <b className="mr-1.5 text-[14px] text-slate-400 line-through">{r.asked}</b>}→{' '}
                  <b className="text-[14px] text-slate-900">{r.spoken}</b> <span className="text-slate-400">({r.sayAs})</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {playBtn('Listen', () => play(r.key, r.spoken), !!playing, playing === r.key)}
                  {r.status === 'pending' && r.requestId ? (
                    <button
                      type="button"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(r.requestId as string)}
                      className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Take back
                    </button>
                  ) : (
                    <button type="button" onClick={() => improve(r)} className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
                      {r.status === 'declined' ? 'Try again' : 'Suggest a change'}
                    </button>
                  )}
                </span>
              </div>
              {r.reply && <p className="mt-1 text-[12px] text-slate-600">Qravy: “{r.reply}”</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
          No words yet. For example: ষোল → say it like sholo, so the voice says “sholo”, not “shol”.
        </p>
      )}
    </div>
  );
}
