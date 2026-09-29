// apps/tastebud/src/pages/VoiceTest.tsx
// DEV ONLY (/voice-test): listen to how each Azure Bangla voice / respelling says a sentence, to pick the right
// pronunciation by ear (e.g. "ভালো আছি" → achhi, not "aci"). Not routed in production builds.
import React, { useState } from 'react';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

const TOKEN_URL = import.meta.env.VITE_SPEECH_TOKEN_URL || '/azure/speech-token';

const VOICES = ['bn-IN-BashkarNeural', 'bn-IN-TanishaaNeural', 'bn-BD-PradeepNeural', 'bn-BD-NabanitaNeural'];
const SPELLINGS: Array<[string, string]> = [
  ['as written', 'ভালো আছি, ধন্যবাদ! আপনি কেমন আছেন?'],
  ['চ + হ  (আচ্‌হি)', 'ভালো আচ্‌হি, ধন্যবাদ! আপনি কেমন আছেন?'],
  ['চ্ছ  (আচ্ছি)', 'ভালো আচ্ছি, ধন্যবাদ! আপনি কেমন আছেন?'],
];

async function say(voice: string, text: string) {
  const res = await fetch(TOKEN_URL, { credentials: 'omit' });
  const { token, region } = await res.json();
  const cfg = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  cfg.speechSynthesisVoiceName = voice;
  cfg.speechSynthesisLanguage = voice.split('-').slice(0, 2).join('-');
  const speaker = new sdk.SpeakerAudioDestination();
  const synth = new sdk.SpeechSynthesizer(cfg, sdk.AudioConfig.fromSpeakerOutput(speaker));
  await new Promise<void>((resolve) =>
    synth.speakTextAsync(text, () => { synth.close(); resolve(); }, () => { synth.close(); resolve(); }),
  );
}

export default function VoiceTest() {
  const [custom, setCustom] = useState('ভালো আছি');
  const [busy, setBusy] = useState('');
  const play = async (label: string, voice: string, text: string) => {
    setBusy(label);
    try {
      await say(voice, text);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="mx-auto max-w-xl p-5 font-[Inter]" style={{ fontFamily: "'Noto Sans Bengali', system-ui" }}>
      <h1 className="text-xl font-bold">Voice test (dev only)</h1>
      <p className="mt-1 text-sm text-gray-500">Tap to listen. Pick the voice + spelling that says it right.</p>
      {VOICES.map((v) => (
        <section key={v} className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{v}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {SPELLINGS.map(([label, text]) => (
              <button
                key={label}
                type="button"
                disabled={!!busy}
                onClick={() => void play(`${v} ${label}`, v, text)}
                className="rounded-full border border-rose-200 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy === `${v} ${label}` ? '…' : label}
              </button>
            ))}
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void play(`${v} custom`, v, custom)}
              className="rounded-full bg-[#FA2851] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy === `${v} custom` ? '…' : 'your text'}
            </button>
          </div>
        </section>
      ))}
      <label className="mt-5 block text-sm font-medium">Your text</label>
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
      />
    </div>
  );
}
