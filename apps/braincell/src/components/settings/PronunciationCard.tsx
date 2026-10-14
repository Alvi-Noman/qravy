// apps/braincell/src/components/settings/PronunciationCard.tsx — Settings → AI Waiter → Pronunciation.
// Qravy's pronunciation dictionary is ONE for every restaurant: a word the voice says wrong ("ষোল" read "shol") is fixed
// once ("sholo") and every restaurant's waiter says it that way from then on. Here a restaurant teaches new words and
// improves others'; Qravy's own (🔒) are fixed by Qravy. A live preview shows what the voice will read ("শোলো") and
// ▶ plays it now vs with the fix.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockClosedIcon, MagnifyingGlassIcon, SpeakerWaveIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTenant } from '../../hooks/useTenant';
import { listWords, removeWord, saveWord, type DictWord } from '../../api/pronunciations';
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
  you: { text: 'Added by you', cls: 'bg-emerald-50 text-emerald-800' },
  'another restaurant': { text: 'Another restaurant', cls: 'bg-slate-100 text-slate-600' },
};

/** One word of the dictionary: hear it, improve it (unless Qravy's), remove it (if it's yours). */
function WordRow({ w, voice, onSaved }: { w: DictWord; voice: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [sayAs, setSayAs] = useState(w.sayAs);
  const spoken = useSpoken(editing ? sayAs : '');
  const { playing, play } = usePlayer(voice);
  const save = useMutation({
    mutationFn: () => saveWord(w.word, sayAs),
    onSuccess: () => {
      toastSuccess(`“${w.word}” — every restaurant’s waiter says it the new way now`);
      setEditing(false);
      onSaved();
    },
    onError: (e) => toastError(errorOf(e, 'Could not save it')),
  });
  const remove = useMutation({
    mutationFn: () => removeWord(w.word),
    onSuccess: () => {
      toastSuccess(`“${w.word}” removed`);
      onSaved();
    },
    onError: (e) => toastError(errorOf(e, 'Could not remove it')),
  });

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-[90px] font-medium text-slate-900">{w.word}</span>
        <span className="text-[12px] text-slate-500">
          → <b className="text-[14px] text-slate-900">{editing ? spoken || '—' : w.spoken}</b>
          {!editing && <span className="ml-1 text-slate-400">({w.sayAs})</span>}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[w.by].cls}`}>
          {w.locked && <LockClosedIcon className="h-3 w-3" />}
          {BADGE[w.by].text}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {playBtn('Now', () => play('now', w.word), !!playing, playing === 'now')}
          {playBtn('Fixed', () => play('fixed', editing ? spoken : w.spoken), !!playing || (editing && !spoken), playing === 'fixed')}
          {!w.locked && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
              Improve
            </button>
          )}
          {w.by === 'you' && !w.locked && !editing && (
            <button
              type="button"
              onClick={() => window.confirm(`Remove “${w.word}”? The voice goes back to reading it on its own — for every restaurant.`) && remove.mutate()}
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove ${w.word}`}
            >
              <TrashIcon className="h-4 w-4" />
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
            disabled={save.isPending || !sayAs.trim() || sayAs.trim() === w.sayAs}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#2e2e30] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save for everyone'}
          </button>
          <button type="button" onClick={() => (setEditing(false), setSayAs(w.sayAs))} className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

export default function PronunciationCard() {
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const voice = tenant?.waiterVoice === 'female' ? VOICES.female : VOICES.male;
  const words = useQuery({ queryKey: ['dictionary'], queryFn: listWords });
  const refresh = () => qc.invalidateQueries({ queryKey: ['dictionary'] });

  // teaching a new word (or a better way to say one)
  const [word, setWord] = useState('');
  const [sayAs, setSayAs] = useState('');
  const spoken = useSpoken(sayAs);
  const { playing, play } = usePlayer(voice);
  const existing = (words.data ?? []).find((w) => w.word.toLowerCase() === word.trim().toLowerCase());
  const add = useMutation({
    mutationFn: () => saveWord(word.trim(), sayAs.trim()),
    onSuccess: () => {
      toastSuccess(`“${word.trim()}” — every restaurant’s waiter says it this way now`);
      setWord('');
      setSayAs('');
      refresh();
    },
    onError: (e) => toastError(errorOf(e, 'Could not save it')),
  });

  const [q, setQ] = useState('');
  const [shown, setShown] = useState(30);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (words.data ?? []).filter((w) => !s || w.word.toLowerCase().includes(s) || w.sayAs.toLowerCase().includes(s) || w.spoken.includes(q.trim()));
  }, [words.data, q]);

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="text-[14px] font-semibold text-slate-900">Pronunciation</div>
      <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
        Does the voice say a word wrong — your restaurant’s name, a dish? Teach it once: type the word as it appears, then how to say it in English
        letters the way you’d type Bangla (<b>sholo</b>, <b>kacchi</b>; every letter is said; capitals <b>T D N R Sh</b> for ট ড ণ ড় ষ) or in Bangla.
        <b> Qravy uses one dictionary for every restaurant</b> — your fix improves every waiter on Qravy, and theirs improve yours.
      </p>

      {/* teach a word */}
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
            disabled={add.isPending || !word.trim() || !spoken || !!existing?.locked}
            className="rounded-md bg-[#2e2e30] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {add.isPending ? 'Saving…' : existing ? 'Improve for everyone' : 'Save for everyone'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
          <span>
            Voice reads: <b className="text-[14px] text-slate-900">{spoken || '—'}</b>
          </span>
          {existing && (
            <span className={existing.locked ? 'text-amber-700' : 'text-slate-500'}>
              {existing.locked ? `Qravy already set “${existing.word}” → ${existing.spoken}; it can’t be changed here.` : `Already in the dictionary as ${existing.spoken} — saving replaces it.`}
            </span>
          )}
          <span className="ml-auto flex gap-2">
            {playBtn('Now', () => play('now', word), !word.trim() || !!playing, playing === 'now')}
            {playBtn('With your fix', () => play('fixed', spoken), !spoken || !!playing, playing === 'fixed')}
          </span>
        </div>
      </div>

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
              <WordRow key={w.word} w={w} voice={voice} onSaved={refresh} />
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
          {q ? 'No word matches.' : 'No words yet. For example: ষোল → say it like sholo, so the voice says “sholo”, not “shol”.'}
        </p>
      )}
    </div>
  );
}
