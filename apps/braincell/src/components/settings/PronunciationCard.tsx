// apps/braincell/src/components/settings/PronunciationCard.tsx — Settings → AI Waiter → Pronunciation.
// A word the waiter's voice says wrong ("ষোল" read "shol") gets a "say it like" in English letters ("sholo") or Bangla;
// a live preview shows what the voice will read ("শোলো"), and ▶ plays it now vs with the fix. Saved on the restaurant;
// Qravy's own list (Cortex) applies too, this one wins.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, SpeakerWaveIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { toastError, toastSuccess } from '../Toaster';
import { speak, spokenFor, VOICES } from '../../utils/speech';

type Row = { word: string; sayAs: string; spoken?: string };
const MAX = 100;

/** "sholo" → "শোলো" as they type (a little after they stop). */
function useSpoken(sayAs: string, saved?: string): string {
  const [spoken, setSpoken] = useState(saved ?? '');
  useEffect(() => {
    if (!sayAs.trim()) return setSpoken('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      spokenFor(sayAs, ctl.signal)
        .then(setSpoken)
        .catch(() => undefined);
    }, 250);
    return () => {
      ctl.abort();
      window.clearTimeout(id);
    };
  }, [sayAs]);
  return spoken;
}

function PronunciationRow({ row, voice, onChange, onRemove }: { row: Row; voice: string; onChange: (r: Row) => void; onRemove: () => void }) {
  const spoken = useSpoken(row.sayAs, row.spoken);
  const [playing, setPlaying] = useState<'now' | 'fixed' | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const play = async (which: 'now' | 'fixed') => {
    const text = which === 'now' ? row.word : spoken;
    if (!text.trim()) return;
    audio.current?.pause();
    setPlaying(which);
    try {
      audio.current = await speak(voice, text);
      audio.current.onended = () => setPlaying(null);
    } catch {
      toastError('Could not play it');
      setPlaying(null);
    }
  };

  const playBtn = (which: 'now' | 'fixed', label: string, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled || !!playing}
      onClick={() => play(which)}
      className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      aria-label={`Play ${row.word || 'the word'} ${which === 'now' ? 'as the voice says it now' : 'with your fix'}`}
    >
      <SpeakerWaveIcon className={`h-3.5 w-3.5 ${playing === which ? 'animate-pulse' : ''}`} />
      {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Word</span>
          <input
            value={row.word}
            maxLength={60}
            onChange={(e) => onChange({ ...row, word: e.target.value })}
            placeholder="ষোল  or  Sholo"
            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Say it like</span>
          <input
            value={row.sayAs}
            maxLength={80}
            onChange={(e) => onChange({ ...row, sayAs: e.target.value, spoken: undefined })}
            placeholder="sholo"
            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="justify-self-end rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
          aria-label="Delete this word"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
        <span>
          Voice reads: <b className="text-[14px] text-slate-900">{spoken || '—'}</b>
        </span>
        <span className="ml-auto flex gap-2">
          {playBtn('now', 'Now', !row.word.trim())}
          {playBtn('fixed', 'With your fix', !spoken)}
        </span>
      </div>
    </div>
  );
}

export default function PronunciationCard() {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const saved = (tenant?.pronunciations ?? []) as Row[];
  const [rows, setRows] = useState<Row[]>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRows(saved), [tenant?.pronunciations]); // eslint-disable-line react-hooks/exhaustive-deps
  const voice = tenant?.waiterVoice === 'female' ? VOICES.female : VOICES.male;
  const strip = (rs: Row[]) => rs.map((r) => ({ word: r.word.trim(), sayAs: r.sayAs.trim() }));
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(saved));
  const complete = rows.every((r) => r.word.trim() && r.sayAs.trim());

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ pronunciations: strip(rows) }, token as string);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Pronunciations saved — the voice uses them from the next thing it says');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the pronunciations');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-slate-900">Pronunciation</div>
          <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
            Does the voice say a word wrong — your restaurant’s name, a dish? Type the word as it appears, then how to say it, in English
            letters the way you’d type Bangla (<b>sholo</b>, <b>kacchi</b>) or in Bangla. Every letter you type is said. Use capitals for the
            hard sounds: <b>T D N R Sh</b> (ট ড ণ ড় ষ).
          </p>
        </div>
        <span className="text-[12px] text-slate-400">
          {rows.length} / {MAX}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <PronunciationRow
            key={i}
            row={r}
            voice={voice}
            onChange={(next) => setRows((rs) => rs.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setRows((rs) => rs.filter((_, j) => j !== i))}
          />
        ))}
        {!rows.length && (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
            No words yet. For example: <b>ষোল</b> → say it like <b>sholo</b>, so the voice says “sholo”, not “shol”.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={rows.length >= MAX}
          onClick={() => setRows((rs) => [...rs, { word: '', sayAs: '' }])}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" /> Add a word
        </button>
        {dirty && (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving || !complete}
              className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setRows(saved)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Discard
            </button>
            {!complete && <span className="text-[12px] text-amber-700">Fill in both the word and how to say it.</span>}
          </>
        )}
      </div>
    </div>
  );
}
