// apps/cortex/src/pages/Pronunciation.tsx — Qravy's pronunciation list for every restaurant's AI waiter.
// A word the Bangla voice says wrong ("ষোল" read "shol") → how to say it, typed in English letters ("sholo") or Bangla;
// the preview shows what the voice reads ("শোলো") and ▶ plays it now vs with the fix. A restaurant's own list
// (its Settings → AI Waiter) wins over this one for the same word.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Card, ErrorBox, Loading } from '../components/ui';

type Row = { word: string; sayAs: string; spoken?: string };
const MAX = 300;
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

function RowEditor({ row, voice, onChange, onRemove }: { row: Row; voice: string; onChange: (r: Row) => void; onRemove: () => void }) {
  const [spoken, setSpoken] = useState(row.spoken ?? '');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!row.sayAs.trim()) return setSpoken('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => spokenFor(row.sayAs, ctl.signal).then(setSpoken).catch(() => undefined), 250);
    return () => (ctl.abort(), window.clearTimeout(id));
  }, [row.sayAs]);

  const play = async (which: 'now' | 'fixed') => {
    const text = which === 'now' ? row.word : spoken;
    if (!text.trim()) return;
    audio.current?.pause();
    setPlaying(which);
    try {
      audio.current = await speak(voice, text);
      audio.current.onended = () => setPlaying(null);
    } catch {
      setPlaying(null);
    }
  };

  return (
    <tr className="border-t border-stone-100 align-middle">
      <td className="py-2 pr-2">
        <input value={row.word} maxLength={60} onChange={(e) => onChange({ ...row, word: e.target.value })} placeholder="ষোল  or  Sholo" className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-[13px]" aria-label="Word" />
      </td>
      <td className="py-2 pr-2">
        <input value={row.sayAs} maxLength={80} onChange={(e) => onChange({ ...row, sayAs: e.target.value, spoken: undefined })} placeholder="sholo" className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-[13px]" aria-label="Say it like" />
      </td>
      <td className="py-2 pr-2 text-[14px] font-medium text-stone-900">{spoken || '—'}</td>
      <td className="py-2 pr-2 text-right">
        <div className="inline-flex gap-1.5">
          {(['now', 'fixed'] as const).map((w) => (
            <button
              key={w}
              type="button"
              disabled={!!playing || !(w === 'now' ? row.word.trim() : spoken)}
              onClick={() => play(w)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[12px] text-stone-700 hover:bg-stone-50 disabled:opacity-40"
            >
              {playing === w ? '…' : '▶'} {w === 'now' ? 'Now' : 'Fixed'}
            </button>
          ))}
          <button type="button" onClick={onRemove} className="rounded-md px-2 py-1 text-[12px] text-red-700 hover:bg-red-50" aria-label="Delete">
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function Pronunciation() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pronunciations'], queryFn: () => api<{ list: Row[]; updatedAt: string | null; updatedBy: string | null }>('/pronunciations') });
  const saved = q.data?.list ?? [];
  const [rows, setRows] = useState<Row[]>([]);
  const [voice, setVoice] = useState<string>(VOICES.male);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setRows(q.data?.list ?? []), [q.data]);
  const strip = (rs: Row[]) => rs.map((r) => ({ word: r.word.trim(), sayAs: r.sayAs.trim() }));
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(saved));
  const complete = rows.every((r) => r.word.trim() && r.sayAs.trim());

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await api<{ list: Row[] }>('/pronunciations', { method: 'PUT', body: JSON.stringify({ list: strip(rows) }) });
      qc.setQueryData(['pronunciations'], { ...q.data, list: r.list, updatedAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold text-stone-900">Pronunciation</h1>
        <p className="max-w-3xl text-[13px] text-stone-500">
          Words every restaurant’s AI waiter says wrong. Type the word as it appears, then how to say it — in English letters the way
          Bangladeshis type Bangla (<b>sholo</b>, <b>kacchi</b>), every letter is said; capitals <b>T D N R Sh</b> for ট ড ণ ড় ষ — or in
          Bangla. A restaurant’s own list (Settings → AI Waiter) wins over this one.
        </p>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <Card
          title={`${rows.length} / ${MAX} words`}
          subtitle={q.data.updatedAt ? `Last saved ${new Date(q.data.updatedAt).toLocaleString()}${q.data.updatedBy ? ` by ${q.data.updatedBy}` : ''}` : 'Nothing saved yet'}
          right={
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[12px]" aria-label="Voice to listen with">
              <option value={VOICES.male}>Listen: male voice</option>
              <option value={VOICES.female}>Listen: female voice</option>
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="pb-2 pr-2 font-semibold">Word</th>
                  <th className="pb-2 pr-2 font-semibold">Say it like</th>
                  <th className="pb-2 pr-2 font-semibold">Voice reads</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <RowEditor
                    key={i}
                    row={r}
                    voice={voice}
                    onChange={(next) => setRows((rs) => rs.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="py-3 text-[13px] text-stone-500">No words yet — e.g. ষোল → sholo.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={rows.length >= MAX}
              onClick={() => setRows((rs) => [...rs, { word: '', sayAs: '' }])}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-[13px] text-stone-800 hover:bg-stone-50"
            >
              + Add a word
            </button>
            {dirty && (
              <>
                <button type="button" onClick={save} disabled={saving || !complete} className="rounded-md bg-stone-900 px-4 py-1.5 text-[13px] text-white disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save for every restaurant'}
                </button>
                <button type="button" onClick={() => setRows(saved)} className="rounded-md px-3 py-1.5 text-[13px] text-stone-600 hover:bg-stone-50">
                  Discard
                </button>
              </>
            )}
            {!complete && dirty && <span className="text-[12px] text-amber-700">Fill in both the word and how to say it.</span>}
            {error && <span className="text-[12px] text-red-700">{error}</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
