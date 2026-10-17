// apps/braincell/src/components/menu-item-modal/ItemPronunciation.tsx — how the AI waiter says this dish: Listen (the
// real voice, with this restaurant's own words applied), and "Sounds like" to change it. A change applies to this
// restaurant's voice at once (routes/pronounceRoutes.ts, its own words); Qravy also gets a quiet hint for its dictionary.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SpeakerWaveIcon, StopIcon } from '@heroicons/react/24/outline';
import { listOwnWords, resetOwnWord, setOwnWord, voiceTextFor } from '../../api/pronunciations';
import { speak, spokenFor, VOICES } from '../../utils/speech';
import { useTenant } from '../../hooks/useTenant';
import { toastError, toastSuccess } from '../Toaster';

/** Plays how the waiter says `text` (this restaurant's voice and words). Returns [playing, play, stop]. */
export function useSayIt(): [boolean, (text: string, raw?: boolean) => Promise<void>, () => void] {
  const { data: tenant } = useTenant();
  const voice = tenant?.waiterVoice === 'female' ? VOICES.female : VOICES.male;
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
  };
  const play = async (text: string, raw = false) => {
    if (!text.trim()) return;
    stop();
    setPlaying(true);
    try {
      const said = raw ? text : await voiceTextFor(text);
      const a = await speak(voice, said);
      audio.current = a;
      a.onended = () => setPlaying(false);
    } catch {
      toastError('Could not play it');
      setPlaying(false);
    }
  };
  useEffect(() => () => audio.current?.pause(), []);
  return [playing, play, stop];
}

export default function ItemPronunciation({ name }: { name: string }) {
  const qc = useQueryClient();
  const own = useQuery({ queryKey: ['own-words'], queryFn: listOwnWords, staleTime: 30_000 });
  const word = name.trim();
  const mine = (own.data ?? []).find((o) => o.word.toLowerCase() === word.toLowerCase());
  const [open, setOpen] = useState(false);
  const [sayAs, setSayAs] = useState('');
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [playing, play, stop] = useSayIt();

  useEffect(() => setSayAs(mine?.sayAs ?? ''), [mine?.sayAs]);
  useEffect(() => {
    if (!sayAs.trim()) return setPreview('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => spokenFor(sayAs, ctl.signal).then(setPreview).catch(() => undefined), 250);
    return () => (ctl.abort(), window.clearTimeout(id));
  }, [sayAs]);

  if (!word) return null;

  const save = async () => {
    setSaving(true);
    try {
      await setOwnWord(word, sayAs.trim());
      await qc.invalidateQueries({ queryKey: ['own-words'] });
      toastSuccess(`The waiter now says “${word}” this way`);
      setOpen(false);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save it');
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    setSaving(true);
    try {
      await resetOwnWord(word);
      await qc.invalidateQueries({ queryKey: ['own-words'] });
      setSayAs('');
      toastSuccess(`Back to the usual way of saying “${word}”`);
    } catch {
      toastError('Could not reset it');
    } finally {
      setSaving(false);
    }
  };

  const btn = 'inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50';
  return (
    <div className="mt-2 rounded-md border border-[#ececec] bg-white px-3 py-2 text-[12px] text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <span>How the waiter says it{mine ? ' (your way)' : ''}</span>
        <button type="button" className={btn} onClick={() => (playing ? stop() : void play(word))} aria-label={`Listen to how the waiter says ${word}`}>
          {playing ? <StopIcon className="h-3.5 w-3.5" /> : <SpeakerWaveIcon className="h-3.5 w-3.5" />} {playing ? 'Stop' : 'Listen'}
        </button>
        {!open && (
          <button type="button" className="text-[12px] text-slate-700 underline underline-offset-2" onClick={() => setOpen(true)}>
            {mine ? 'Change' : 'Sounds wrong? Fix it'}
          </button>
        )}
        {mine && !open && (
          <button type="button" className="text-[12px] text-slate-500 underline underline-offset-2" disabled={saving} onClick={() => void reset()}>
            Use the usual way
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sounds like</span>
            <input
              value={sayAs}
              maxLength={100}
              onChange={(e) => setSayAs(e.target.value)}
              placeholder="Type it the way it should sound — e.g. sholo ana bangali, or in Bangla"
              aria-label="How it should sound"
              className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Voice will say: <b className="text-[14px] text-slate-900">{preview || '…'}</b>
            </span>
            <button type="button" className={btn} disabled={!preview} onClick={() => (playing ? stop() : void play(preview, true))}>
              <SpeakerWaveIcon className="h-3.5 w-3.5" /> Try it
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" className="rounded-md px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-[#2e2e30] px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
                disabled={saving || !sayAs.trim() || !preview}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
