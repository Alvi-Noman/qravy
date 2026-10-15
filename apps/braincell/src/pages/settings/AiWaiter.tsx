// apps/braincell/src/pages/settings/AiWaiter.tsx — Settings → AI Waiter: everything about the restaurant's AI waiter.
// Its name ("Pixie" until they name it), the language it starts in, its voice (with a sample), the owner's own answers
// to the questions guests ask ("Do you have parking?" → "Yes, free, behind the building") and the facts it may share.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, SpeakerWaveIcon, StopIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../context/AuthContext';
import { useTenant } from '../../hooks/useTenant';
import { updateTenant } from '../../api/tenant';
import { toastError, toastSuccess } from '../../components/Toaster';
import WaiterLanguageCard from '../../components/settings/WaiterLanguageCard';
import { WaiterKnowledgeCard } from '../MenuLayout';
import PronunciationCard from '../../components/settings/PronunciationCard';
import { speak, spokenFor, VOICES as AZURE } from '../../utils/speech';
import { listRequests, listWords, requestWord } from '../../api/pronunciations';

const card = 'rounded-xl border border-[#ececec] bg-white p-4 shadow-sm';

// the storefront's voices (apps/tastebud/src/components/StoreBranding.tsx) — Bangladeshi Bangla, they read English too
const VOICES = [
  { id: 'female' as const, label: 'Female', azure: AZURE.female },
  { id: 'male' as const, label: 'Male', azure: AZURE.male },
];

const MAX_ANSWERS = 50;

/* ------------------------------------------------------------------ name */

function NameCard() {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const saved = tenant?.waiterName || '';
  // how the name sounds = the name's word in Qravy's pronunciation dictionary (every restaurant's voice uses it);
  // a change is a request Qravy reviews, so the field shows the request while it waits
  const dict = useQuery({ queryKey: ['dictionary'], queryFn: listWords });
  const requests = useQuery({ queryKey: ['dictionary-requests'], queryFn: listRequests });
  const nameKey = (saved || 'pixie').toLowerCase();
  const entry = (dict.data ?? []).find((p) => p.word.toLowerCase() === nameKey);
  const asked = (requests.data ?? []).find((r) => r.status === 'pending' && r.word.toLowerCase() === nameKey);
  const savedSayAs = asked?.sayAs ?? entry?.sayAs ?? '';
  const [name, setName] = useState(saved);
  const [sayAs, setSayAs] = useState(savedSayAs);
  const [spoken, setSpoken] = useState('');
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setName(saved), [saved]);
  useEffect(() => setSayAs(savedSayAs), [savedSayAs]);
  useEffect(() => {
    if (!sayAs.trim()) return setSpoken('');
    const ctl = new AbortController();
    const id = window.setTimeout(() => spokenFor(sayAs, ctl.signal).then(setSpoken).catch(() => undefined), 250);
    return () => (ctl.abort(), window.clearTimeout(id));
  }, [sayAs]);
  const shown = name.trim() || 'Pixie';
  const voice = tenant?.waiterVoice === 'female' ? AZURE.female : AZURE.male;
  const dirty = name.trim() !== saved || sayAs.trim() !== savedSayAs;

  const listen = async () => {
    const text = spoken || shown;
    setPlaying(true);
    try {
      const a = await speak(voice, `আমি ${text}`);
      a.onended = () => setPlaying(false);
    } catch {
      toastError('Could not play it');
      setPlaying(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ waiterName: name.trim() || null }, token as string);
      // how it sounds: a request to Qravy (unless the dictionary already says it that way)
      const current = (dict.data ?? []).find((p) => p.word.toLowerCase() === shown.toLowerCase());
      const ask = !!sayAs.trim() && (sayAs.trim() !== savedSayAs || shown !== (saved || 'Pixie')) && spoken !== current?.spoken;
      if (ask) {
        // 409: the waiter already says it that way — nothing to ask for
        await requestWord(shown, sayAs.trim(), 'Our waiter’s name').catch((e) => {
          if (e?.response?.status !== 409) throw e;
        });
      }
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      await qc.invalidateQueries({ queryKey: ['dictionary-requests'] });
      toastSuccess(ask ? `Saved — Qravy will review how “${shown}” sounds` : `Your waiter is now called ${shown}`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the name');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={card}>
      <div className="text-[14px] font-semibold text-slate-900">Name</div>
      <p className="mt-0.5 text-[12px] text-slate-500">What your waiter calls itself when it greets guests. Leave it empty to keep “Pixie”.</p>
      <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
          <input
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pixie"
            aria-label="Waiter name"
            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sounds like</span>
          <input
            value={sayAs}
            maxLength={80}
            onChange={(e) => setSayAs(e.target.value)}
            placeholder="e.g. mitu  (optional)"
            aria-label="How the name sounds"
            className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-2 flex max-w-xl flex-wrap items-center gap-2 text-[12px] text-slate-600">
        <span>
          Voice says: <b className="text-[14px] text-slate-900">{spoken || shown}</b>
        </span>
        <button
          type="button"
          onClick={listen}
          disabled={playing}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <SpeakerWaveIcon className={`h-3.5 w-3.5 ${playing ? 'animate-pulse' : ''}`} /> Listen
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="ml-auto rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Type how it sounds in English letters, the way you’d type Bangla (every letter is said), or in Bangla — only if the voice says the name wrong.
        Qravy reviews it before the waiter says it that way.
      </p>
      {asked && (
        <p className="mt-1 text-[12px] text-amber-700">
          Waiting for Qravy: “{asked.word}” → {asked.spoken}. Until then guests hear {entry?.spoken || asked.word}.
        </p>
      )}
      <div className="mt-4 max-w-xl rounded-2xl bg-[#FFF5F7] px-4 py-3 text-[13px] text-slate-800">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[#FA2851]">Guests see</span>
        <p className="mt-1">
          Welcome to {tenant?.name || 'your restaurant'}! I’m <b>{shown}</b>, your virtual waiter. Ask me anything about the menu, or tell me what
          you’d like to order.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ voice */

function VoiceCard() {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const saved = tenant?.waiterVoice === 'female' ? 'female' : 'male';
  const [saving, setSaving] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const waiter = tenant?.waiterName || 'Pixie';
  const restaurant = tenant?.name || '';

  const stop = () => {
    abort.current?.abort();
    audio.current?.pause();
    setPlaying(null);
  };
  useEffect(() => stop, []);

  const play = async (v: (typeof VOICES)[number]) => {
    stop();
    setPlaying(v.id);
    const ctl = new AbortController();
    abort.current = ctl;
    const text =
      tenant?.waiterLanguage === 'en'
        ? `Welcome${restaurant ? ` to ${restaurant}` : ''}! I'm ${waiter}, your virtual waiter. What would you like today?`
        : `${restaurant ? `${restaurant}-এ ` : ''}স্বাগতম! আমি ${waiter === 'Pixie' ? 'পিক্সি' : waiter}, আপনার ভার্চুয়াল ওয়েটার। আজ কী খেতে চান?`;
    try {
      audio.current = await speak(v.azure, text, ctl.signal);
      audio.current.onended = () => setPlaying(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toastError('Could not play the sample');
      setPlaying(null);
    }
  };

  const choose = async (id: 'female' | 'male') => {
    if (id === saved || saving) return;
    setSaving(id);
    try {
      await updateTenant({ waiterVoice: id }, token as string);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess(`Your waiter now speaks with the ${id} voice`);
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the voice');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={card}>
      <div className="text-[14px] font-semibold text-slate-900">Voice</div>
      <p className="mt-0.5 text-[12px] text-slate-500">The voice guests hear when the waiter speaks — in Bangla and in English.</p>
      <div role="radiogroup" aria-label="Waiter voice" className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
        {VOICES.map((v) => {
          const on = (saving ?? saved) === v.id;
          return (
            <div
              key={v.id}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${on ? 'border-[#2e2e30] bg-slate-50' : 'border-[#e2e2e2]'}`}
            >
              <button type="button" role="radio" aria-checked={on} onClick={() => choose(v.id)} className="flex flex-1 items-center gap-2 text-left">
                <span className={`grid h-4 w-4 place-items-center rounded-full border ${on ? 'border-[#2e2e30]' : 'border-slate-300'}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-[#2e2e30]" />}
                </span>
                <span className="text-[13px] font-medium text-slate-900">{v.label}</span>
              </button>
              <button
                type="button"
                onClick={() => (playing === v.id ? stop() : play(v))}
                className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
                aria-label={`${playing === v.id ? 'Stop' : 'Play'} the ${v.label.toLowerCase()} voice`}
              >
                {playing === v.id ? <StopIcon className="h-3.5 w-3.5" /> : <SpeakerWaveIcon className="h-3.5 w-3.5" />}
                {playing === v.id ? 'Stop' : 'Play sample'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the owner's answers */

type QA = { question: string; answer: string };

const EXAMPLES: QA[] = [
  { question: 'Do you have parking?', answer: 'Yes — free parking right behind the building.' },
  { question: 'Is the food halal?', answer: 'Yes, all our meat is halal.' },
  { question: 'Can I book a table for a birthday?', answer: 'Yes! Call us on 01XXXXXXXXX and we’ll set it up.' },
];

function AnswersCard() {
  const { token } = useAuthContext();
  const qc = useQueryClient();
  const { data: tenant } = useTenant();
  const saved = (tenant?.customAnswers ?? []) as QA[];
  const [rows, setRows] = useState<QA[]>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRows(saved), [tenant?.customAnswers]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const complete = rows.every((r) => r.question.trim().length >= 2 && r.answer.trim());

  const set = (i: number, patch: Partial<QA>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await updateTenant({ customAnswers: rows.map((r) => ({ question: r.question.trim(), answer: r.answer.trim() })) }, token as string);
      await qc.invalidateQueries({ queryKey: ['tenant', token] });
      toastSuccess('Answers saved — your waiter uses them right away');
    } catch (e: any) {
      toastError(e?.response?.data?.message || 'Could not save the answers');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-slate-900">Your answers</div>
          <p className="mt-0.5 max-w-2xl text-[12px] text-slate-500">
            Tell the waiter how to answer the questions guests ask you. It understands other ways of asking the same thing — in Bangla or
            English — and replies in the guest’s language, using exactly your facts.
          </p>
        </div>
        <span className="text-[12px] text-slate-400">
          {rows.length} / {MAX_ANSWERS}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <div className="grid flex-1 gap-2">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">When a guest asks</span>
                  <input
                    value={r.question}
                    maxLength={200}
                    onChange={(e) => set(i, { question: e.target.value })}
                    placeholder="e.g. Do you have parking?"
                    className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">The waiter answers</span>
                  <textarea
                    value={r.answer}
                    maxLength={800}
                    rows={2}
                    onChange={(e) => set(i, { answer: e.target.value })}
                    placeholder="e.g. Yes — free parking right behind the building."
                    className="rounded-md border border-[#e2e2e2] px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-6 rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Delete this answer"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {!rows.length && (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-[13px] text-slate-600">
            <p className="font-medium text-slate-800">No answers yet. Popular ones:</p>
            <ul className="mt-2 space-y-1">
              {EXAMPLES.map((x) => (
                <li key={x.question}>
                  <button type="button" onClick={() => setRows((rs) => [...rs, x])} className="text-left underline decoration-slate-300 hover:text-slate-900">
                    + {x.question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={rows.length >= MAX_ANSWERS}
          onClick={() => setRows((rs) => [...rs, { question: '', answer: '' }])}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" /> Add an answer
        </button>
        {dirty && (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving || !complete}
              className="rounded-md bg-[#2e2e30] px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save answers'}
            </button>
            <button type="button" onClick={() => setRows(saved)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Discard
            </button>
            {!complete && <span className="text-[12px] text-amber-700">Fill in both the question and the answer.</span>}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function SettingsAiWaiter(): JSX.Element {
  return (
    <div className="grid gap-4">
      <NameCard />
      <WaiterLanguageCard />
      <VoiceCard />
      <PronunciationCard />
      <AnswersCard />
      <WaiterKnowledgeCard />
    </div>
  );
}
